import {
  cropRGBA,
  lineartInput,
  lineartSize,
  lineartToInk,
  maskBox,
  samMask,
  samPreprocess,
  samPromptInputs,
  xdogInk,
  type Box,
  type SamPoint,
  type SamPrepared,
  type TensorIn,
} from './models';
import { LEVELS, type Level } from './presets';
import { abstractImage, resizeRGBA } from './raster';
import { count } from './mask';
import { vectorize, type VectorizeResult } from './vectorize';
import type { Mask, Plane, RGBA } from './types';

export interface TensorOut {
  data: Float32Array;
  dims: readonly number[];
}

/** Spuštění jednoho ONNX modelu – v prohlížeči i v testech jiná implementace. */
export interface Runner {
  run(feeds: Record<string, TensorIn | TensorOut>): Promise<Record<string, TensorOut>>;
}

export interface ModelProvider {
  lineart(): Promise<Runner>;
  sam(): Promise<{ encoder: Runner; decoder: Runner }>;
}

export type Stage = 'prepare' | 'lines' | 'clean';

export interface DrawOptions {
  level: Level;
  detail: number;
  /** Použít vybraný objekt (bez pozadí) a přiblížit na něj. */
  subject: boolean;
}

export interface DrawResult extends VectorizeResult {
  /** Výřez fotky, ze kterého kresba vznikla (v pixelech pracovního obrázku). */
  box: Box;
  /** Kreslilo se záložním filtrem, protože model nebyl k dispozici. */
  fallback: boolean;
}

/**
 * Ateliér drží jednu rozpracovanou fotku a mezivýsledky, aby změna
 * posuvníku detailu nebo úrovně nepočítala znovu to, co už je hotové.
 */
export class Studio {
  private img: RGBA | null = null;
  private samPrep: SamPrepared | null = null;
  private embeddings: Record<string, TensorOut> | null = null;
  private mask: Mask | null = null;
  private inkCache = new Map<string, { ink: Plane; subject: Mask | null; box: Box; fallback: boolean }>();

  constructor(private models: ModelProvider) {}

  setImage(img: RGBA): void {
    this.img = img;
    this.samPrep = null;
    this.embeddings = null;
    this.mask = null;
    this.inkCache.clear();
  }

  get image(): RGBA | null {
    return this.img;
  }

  /** Předpočítá obrazové rysy SAM (nejdražší krok výběru objektu). */
  async prepareSelection(): Promise<void> {
    if (this.embeddings || !this.img) return;
    const { encoder } = await this.models.sam();
    this.samPrep = samPreprocess(this.img);
    this.embeddings = await encoder.run({ pixel_values: this.samPrep.input });
  }

  /**
   * Vybere objekt podle bodů (nebo automaticky podle středu snímku).
   * Vrací masku v rozlišení pracovního obrázku.
   */
  async select(points: SamPoint[]): Promise<{ mask: Mask; score: number; coverage: number }> {
    if (!this.img) throw new Error('Není nahraná fotka.');
    await this.prepareSelection();
    const { decoder } = await this.models.sam();
    const auto = points.length === 0;
    const pts = auto ? [{ x: 0.5, y: 0.5, positive: true }] : points;
    const prompt = samPromptInputs(pts, this.samPrep!);
    const out = await decoder.run({
      input_points: prompt.points,
      input_labels: prompt.labels,
      image_embeddings: this.embeddings!.image_embeddings,
      image_positional_embeddings: this.embeddings!.image_positional_embeddings,
    });
    const res = samMask(out.pred_masks.data, out.iou_scores.data, this.samPrep!, this.img.w, this.img.h, pts.length === 1);
    this.mask = res.mask;
    // Změna výběru znehodnotí kresby, které s ním počítaly.
    for (const key of [...this.inkCache.keys()]) if (key.endsWith(':s')) this.inkCache.delete(key);
    return { ...res, coverage: count(res.mask) / (this.img.w * this.img.h) };
  }

  clearSelection(): void {
    this.mask = null;
  }

  async draw(opts: DrawOptions, onStage?: (s: Stage) => void): Promise<DrawResult> {
    if (!this.img) throw new Error('Není nahraná fotka.');
    const useSubject = opts.subject && this.mask !== null;
    const key = `${opts.level}:${useSubject ? 's' : 'f'}`;
    let cached = this.inkCache.get(key);
    if (!cached) {
      onStage?.('prepare');
      const img = this.img;
      const box = useSubject ? (maskBox(this.mask!, 0.06) ?? full(img)) : full(img);
      const crop = box.w === img.w && box.h === img.h ? img : cropRGBA(img, box);
      const preset = LEVELS[opts.level];
      const { w, h } = lineartSize(crop.w, crop.h, preset.size);
      let small = resizeRGBA(crop, w, h);
      if (preset.abstract) {
        const r = Math.max(1, Math.round(preset.abstract.radius * Math.max(w, h)));
        small = abstractImage(small, r, preset.abstract.eps, preset.abstract.iterations);
      }
      onStage?.('lines');
      let ink: Plane;
      let fallback = false;
      try {
        const net = await this.models.lineart();
        const out = await net.run({ input: lineartInput(small) });
        ink = lineartToInk(out.output.data, w, h);
      } catch (err) {
        // Bez modelu (třeba offline před prvním stažením) aspoň klasická kresba.
        console.warn('Kreslicí síť selhala, použije se záložní filtr.', err);
        ink = xdogInk(small);
        fallback = true;
      }
      const subject = useSubject ? cropMaskTo(this.mask!, box, w, h) : null;
      cached = { ink, subject, box, fallback };
      this.inkCache.set(key, cached);
    }
    onStage?.('clean');
    const result = vectorize(cached.ink, { level: opts.level, detail: opts.detail, subject: cached.subject });
    return { ...result, box: cached.box, fallback: cached.fallback };
  }
}

function full(img: RGBA): Box {
  return { x: 0, y: 0, w: img.w, h: img.h };
}

/** Výřez masky převzorkovaný (nejbližší soused) na rozměry kresby. */
export function cropMaskTo(m: Mask, box: Box, w: number, h: number): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = box.y + Math.min(box.h - 1, Math.floor(((y + 0.5) * box.h) / h));
    for (let x = 0; x < w; x++) {
      const sx = box.x + Math.min(box.w - 1, Math.floor(((x + 0.5) * box.w) / w));
      data[y * w + x] = m.data[sy * m.w + sx];
    }
  }
  return { w, h, data };
}
