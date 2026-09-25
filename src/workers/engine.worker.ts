/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { Studio, type DrawOptions, type ModelProvider, type Runner, type Stage, type TensorOut } from '../engine/studio';
import type { SamPoint, TensorIn } from '../engine/models';
import type { RGBA } from '../engine/types';
import { isCached, loadModel, prefetchRuntime, type ProgressFn } from './model-loader';
import type { ModelKey } from '../lib/model-files';

type Ort = typeof import('onnxruntime-web');
export type Backend = 'webgpu' | 'wasm';

/** Delší strana pracovní kopie fotky – víc se na telefonu nevyplatí. */
const WORK_SIZE = 1600;

let ortP: Promise<{ ort: Ort; backend: Backend }> | null = null;
let progress: ProgressFn | undefined;

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) return false;
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function loadOrt() {
  return (ortP ??= (async () => {
    const gpu = await hasWebGPU();
    const ort: Ort = gpu ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    // Lepidlo (.mjs) i binárka se berou z našeho originu – kvůli offline režimu
    // a vláknům, která si ORT spouští z URL lepidla.
    const dir = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.origin).href;
    const name = gpu ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';
    ort.env.wasm.wasmPaths = { mjs: `${dir}${name}.mjs`, wasm: `${dir}${name}.wasm` };
    await prefetchRuntime(`${dir}${name}.wasm`, gpu ? __ORT_SIZES__.webgpu : __ORT_SIZES__.wasm, progress);
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    ort.env.logLevel = 'error';
    const backend: Backend = gpu ? 'webgpu' : 'wasm';
    return { ort, backend };
  })());
}

function toTensor(ort: Ort, v: TensorIn | TensorOut): Tensor {
  if (v instanceof ort.Tensor) return v;
  const t = v as TensorIn;
  if (t.type === 'int64') return new ort.Tensor('int64', t.data as BigInt64Array, t.dims);
  return new ort.Tensor('float32', t.data as Float32Array, t.dims as number[]);
}

async function createRunner(key: ModelKey): Promise<Runner> {
  const [{ ort, backend }, bytes] = await Promise.all([loadOrt(), loadModel(key, progress)]);
  const create = (eps: string[]) =>
    ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: 'all' });
  let session: InferenceSession;
  let onGpu = backend === 'webgpu';
  try {
    session = await create(onGpu ? ['webgpu', 'wasm'] : ['wasm']);
  } catch (err) {
    if (!onGpu) throw err;
    console.warn(`WebGPU pro ${key} selhalo, přecházím na WASM.`, err);
    session = await create(['wasm']);
    onGpu = false;
  }
  const run = async (feeds: Record<string, TensorIn | TensorOut>) => {
    const t: Record<string, Tensor> = {};
    for (const [k, v] of Object.entries(feeds)) t[k] = toTensor(ort, v);
    const out = await session.run(t);
    const res: Record<string, TensorOut> = {};
    for (const [k, v] of Object.entries(out)) res[k] = v as unknown as TensorOut;
    return res;
  };
  return {
    async run(feeds) {
      try {
        return await run(feeds);
      } catch (err) {
        if (!onGpu) throw err;
        // Některé mobilní GPU zvládnou vytvořit sezení, ale ne výpočet.
        console.warn(`Výpočet ${key} na GPU selhal, zkouším CPU.`, err);
        session = await create(['wasm']);
        onGpu = false;
        return run(feeds);
      }
    },
  };
}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= fn().catch((e) => {
      p = null; // po chybě sítě půjde zkusit znovu
      throw e;
    }));
}

const lineart = memo(() => createRunner('lineart'));
const sam = memo(async () => {
  const [encoder, decoder] = await Promise.all([createRunner('samEncoder'), createRunner('samDecoder')]);
  return { encoder, decoder };
});
const provider: ModelProvider = { lineart, sam };
const studio = new Studio(provider);

function bitmapToRGBA(bmp: ImageBitmap): RGBA {
  const s = Math.min(1, WORK_SIZE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

const api = {
  async backend(): Promise<Backend> {
    return (await loadOrt()).backend;
  },

  async cached(): Promise<{ lineart: boolean; sam: boolean }> {
    const [a, b, c] = await Promise.all([isCached('lineart'), isCached('samEncoder'), isCached('samDecoder')]);
    return { lineart: a, sam: b && c };
  },

  setProgress(fn: ProgressFn | undefined): void {
    progress = fn;
  },

  /** Připraví modely dopředu (zatímco si uživatel prohlíží fotku). */
  async warmup(which: 'lineart' | 'sam'): Promise<void> {
    if (which === 'lineart') await lineart();
    else await sam();
  },

  async setImage(bmp: ImageBitmap): Promise<{ w: number; h: number }> {
    const img = bitmapToRGBA(bmp);
    studio.setImage(img);
    return { w: img.w, h: img.h };
  },

  async select(points: SamPoint[]) {
    const res = await studio.select(points);
    // Kopie: originál masky si Studio drží pro kreslení, přenesený buffer by se vyprázdnil.
    const data = res.mask.data.slice();
    const out = { w: res.mask.w, h: res.mask.h, data, score: res.score, coverage: res.coverage, confident: res.confident };
    return Comlink.transfer(out, [data.buffer]);
  },

  clearSelection(): void {
    studio.clearSelection();
  },

  async draw(opts: DrawOptions, onStage?: (s: Stage) => void) {
    return studio.draw(opts, onStage);
  },
};

export type EngineApi = typeof api;
Comlink.expose(api);
