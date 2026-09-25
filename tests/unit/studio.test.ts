import { beforeAll, describe, expect, it } from 'vitest';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Studio, type ModelProvider, type Runner } from '../../src/engine/studio';
import { components } from '../../src/engine/mask';
import { rasterizeDrawing } from './raster-helper';
import type { Drawing, RGBA } from '../../src/engine/types';

const root = join(__dirname, '..', '..');
const model = (f: string) => join(root, 'public', 'models', f);
const haveModels = existsSync(model('lineart.onnx')) && existsSync(model('sam-encoder.onnx'));

function nodeRunner(path: string): () => Promise<Runner> {
  let p: Promise<Runner> | null = null;
  return () =>
    (p ??= ort.InferenceSession.create(path).then((s) => ({
      async run(feeds) {
        const t: Record<string, ort.Tensor> = {};
        for (const [k, v] of Object.entries(feeds)) {
          t[k] = v instanceof ort.Tensor ? v : new ort.Tensor((v as { type?: 'float32' }).type ?? 'float32', v.data as Float32Array, v.dims as number[]);
        }
        const out = await s.run(t);
        const res: Record<string, { data: Float32Array; dims: readonly number[] }> = {};
        for (const [k, v] of Object.entries(out)) res[k] = v as unknown as { data: Float32Array; dims: readonly number[] };
        return res;
      },
    })));
}

async function photo(name: string): Promise<RGBA> {
  const { data, info } = await sharp(join(root, 'tests', 'fixtures', 'photos', `${name}.jpg`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data) };
}

/** Kolik uzavřených ploch (mimo pozadí) jde vybarvit kyblíkem. */
function fillableRegions(drawing: Drawing, size = 600) {
  const w = size;
  const h = Math.round((size * drawing.h) / drawing.w);
  const lines = rasterizeDrawing(drawing, w, h);
  const free = { w, h, data: lines.data.map((v) => (v ? 0 : 1)) };
  const { areas, touchesBorder } = components(free, 1, 4);
  const inkRatio = lines.data.reduce((a, b) => a + b, 0) / (w * h);
  const closed = areas.filter((a, i) => !touchesBorder[i] && a > (w * h) / 2000).length;
  return { closed, inkRatio };
}

describe.runIf(haveModels)('Studio se skutečnými modely', () => {
  let studio: Studio;
  beforeAll(() => {
    const lineart = nodeRunner(model('lineart.onnx'));
    const encoder = nodeRunner(model('sam-encoder.onnx'));
    const decoder = nodeRunner(model('sam-decoder.onnx'));
    const provider: ModelProvider = {
      lineart,
      sam: async () => ({ encoder: await encoder(), decoder: await decoder() }),
    };
    studio = new Studio(provider);
  });

  it('z fotky kočky udělá omalovánku s uzavřenými plochami', async () => {
    studio.setImage(await photo('cat'));
    const res = await studio.draw({ level: 'mali', detail: 0.5, subject: false });
    expect(res.fallback).toBe(false);
    expect(res.drawing.strokes.length).toBeGreaterThan(5);
    const { closed, inkRatio } = fillableRegions(res.drawing);
    expect(inkRatio).toBeGreaterThan(0.01);
    expect(inkRatio).toBeLessThan(0.2);
    expect(closed).toBeGreaterThan(2);
  });

  it('vyšší úroveň znamená víc detailů', async () => {
    const a = await studio.draw({ level: 'mali', detail: 0.5, subject: false });
    const b = await studio.draw({ level: 'zkuseni', detail: 0.5, subject: false });
    expect(b.drawing.strokes.length).toBeGreaterThan(a.drawing.strokes.length);
  });

  it('posuvník detailu mění množství čar bez nového běhu sítě', async () => {
    const t0 = performance.now();
    const few = await studio.draw({ level: 'skolaci', detail: 0.1, subject: false });
    const t1 = performance.now();
    const many = await studio.draw({ level: 'skolaci', detail: 0.9, subject: false });
    const t2 = performance.now();
    expect(many.reveal.length).toBeGreaterThan(few.reveal.length);
    expect(t2 - t1).toBeLessThan(t1 - t0); // druhé volání bere výsledek sítě z cache
  });

  it('výběr objektu ořízne kresbu na koně a vynechá krajinu', async () => {
    studio.setImage(await photo('horse'));
    const sel = await studio.select([]);
    expect(sel.coverage).toBeGreaterThan(0.01);
    expect(sel.coverage).toBeLessThan(0.5);
    const res = await studio.draw({ level: 'mali', detail: 0.5, subject: true });
    expect(res.box.w).toBeLessThan(studio.image!.w * 0.7);
    expect(res.drawing.strokes.some((s) => s.weight > 1)).toBe(true); // souvislý obrys
    expect(fillableRegions(res.drawing).closed).toBeGreaterThan(0);
  });
});

describe.runIf(haveModels)('automatický výběr postavy', () => {
  it('u holčičky vybere celou postavu, ne jen zip bundy', async () => {
    const lineart = nodeRunner(model('lineart.onnx'));
    const encoder = nodeRunner(model('sam-encoder.onnx'));
    const decoder = nodeRunner(model('sam-decoder.onnx'));
    const studio = new Studio({ lineart, sam: async () => ({ encoder: await encoder(), decoder: await decoder() }) });
    studio.setImage(await photo('girl'));
    const sel = await studio.select([]);
    expect(sel.coverage).toBeGreaterThan(0.2);
    expect(sel.coverage).toBeLessThan(0.5);
  });
});
