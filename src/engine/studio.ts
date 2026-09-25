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
   * Vybere objekt podle bodů. Bez bodů zkusí několik míst kolem středu
   * a vybere masku, na které se kandidáti shodnou (celá postava, ne jen
   * zip bundy), a která není pozadím (nedotýká se okrajů).
   * Vrací masku v rozlišení pracovního obrázku.
   */
  async select(points: SamPoint[]): Promise<{ mask: Mask; score: number; coverage: number }> {
    if (!this.img) throw new Error('Není nahraná fotka.');
    await this.prepareSelection();
    const { decoder } = await this.models.sam();
    const img = this.img;
    const decode = async (pts: SamPoint[]) => {
      const prompt = samPromptInputs(pts, this.samPrep!);
      const out = await decoder.run({
        input_points: prompt.points,
        input_labels: prompt.labels,
        image_embeddings: this.embeddings!.image_embeddings,
        image_positional_embeddings: this.embeddings!.image_positional_embeddings,
      });
      return { pred: out.pred_masks.data, iou: out.iou_scores.data, single: pts.length === 1 };
    };

    let chosen: Awaited<ReturnType<typeof decode>>;
    if (points.length) {
      chosen = await decode(points);
    } else {
      const spots = [
        [0.5, 0.5],
        [0.5, 0.36],
        [0.5, 0.64],
        [0.38, 0.5],
        [0.62, 0.5],
      ];
      const outs = [];
      for (const [x, y] of spots) outs.push(await decode([{ x, y, positive: true }]));
      // Hodnocení v malém rozlišení.
      const sw = 160;
      const sh = Math.max(1, Math.round((sw * img.h) / img.w));
      const small = outs.map((o) => samMask(o.pred, o.iou, this.samPrep!, sw, sh, true));
      const cov = small.map((m) => count(m.mask) / (sw * sh));
      const border = small.map((m) => borderRatio(m.mask));
      const valid = small.map((_, i) => cov[i] > 0.015 && cov[i] < 0.8 && border[i] < 0.3);
      let best = 0;
      let bestScore = -Infinity;
      small.forEach((m, i) => {
        if (!valid[i]) return;
        let support = 0;
        small.forEach((o, j) => {
          if (j !== i && valid[j]) support += maskIoU(m.mask, o.mask);
        });
        const score = support + 0.5 * m.score + Math.min(cov[i], 0.3);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      chosen = outs[best];
    }
    const res = samMask(chosen.pred, chosen.iou, this.samPrep!, img.w, img.h, chosen.single);
    this.mask = res.mask;
    // Změna výběru znehodnotí kresby, které s ním počítaly.
    for (const key of [...this.inkCache.keys()]) if (key.endsWith(':s')) this.inkCache.delete(key);
    return { ...res, coverage: count(res.mask) / (img.w * img.h) };
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

function maskIoU(a: Mask, b: Mask): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const x = a.data[i];
    const y = b.data[i];
    inter += x & y;
    union += x | y;
  }
  return union ? inter / union : 0;
}

/** Podíl okrajových pixelů obrázku, které maska pokrývá (pozadí jich pokrývá hodně). */
function borderRatio(m: Mask): number {
  let n = 0;
  for (let x = 0; x < m.w; x++) n += m.data[x] + m.data[(m.h - 1) * m.w + x];
  for (let y = 0; y < m.h; y++) n += m.data[y * m.w] + m.data[y * m.w + m.w - 1];
  return n / (2 * (m.w + m.h));
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
