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
import { meshDecode, meshInput, nms, roiFromBox, roiFromMesh, yunetDecode, yunetInput, type FaceBox } from './face';
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
  /** Detektor obličejů a síť bodů obličeje (volitelné). */
  face?(): Promise<{ detector: Runner; mesh: Runner }>;
}

export type Stage = 'prepare' | 'lines' | 'clean';

export interface DrawOptions {
  level: Level;
  detail: number;
  /** Použít vybraný objekt (bez pozadí) a přiblížit na něj. */
  subject: boolean;
  style?: 'pen' | 'ink';
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
  private inkCache = new Map<
    string,
    { ink: Plane; subject: Mask | null; box: Box; fallback: boolean; faces: Float32Array[]; faceBoxes: number[][] }
  >();

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
  async select(points: SamPoint[]): Promise<{ mask: Mask; score: number; coverage: number; confident: boolean }> {
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
    // U ručních bodů rozhoduje uživatel; automatika musí mít shodu kandidátů.
    let confident = true;
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
      // Aspoň dva další kandidáti se musí s vítězem zhruba shodovat.
      confident = bestScore - 0.5 * small[best].score - Math.min(cov[best], 0.3) >= 1.1;
    }
    const res = samMask(chosen.pred, chosen.iou, this.samPrep!, img.w, img.h, chosen.single);
    this.mask = res.mask;
    // Změna výběru znehodnotí kresby, které s ním počítaly.
    for (const key of [...this.inkCache.keys()]) if (key.endsWith(':s')) this.inkCache.delete(key);
    return { ...res, coverage: count(res.mask) / (img.w * img.h), confident };
  }

  /**
   * Body obličejů ve výřezu (v jeho pixelech). Chyba modelu kreslení nezastaví –
   * obličeje se pak jen nedokreslí.
   */
  private async findFaces(img: RGBA): Promise<{ meshes: Float32Array[]; unsure: FaceBox[] }> {
    const none = { meshes: [], unsure: [] };
    if (!this.models.face) return none;
    try {
      const { detector, mesh } = await this.models.face();
      const boxes = [];
      // Dvě měřítka: běžné obličeje i detail přes celou fotku.
      for (const fit of [640, 280]) {
        const { input, scale } = yunetInput(img, fit);
        const out = await detector.run({ input });
        boxes.push(...yunetDecode(out, scale));
      }
      const faces: Float32Array[] = [];
      const unsure: FaceBox[] = [];
      for (const b of nms(boxes).slice(0, 8)) {
        let roi = roiFromBox(b);
        let pts: Float32Array | null = null;
        // Druhý průchod s výřezem podle bodů z prvního je přesnější.
        for (let pass = 0; pass < 2; pass++) {
          const r = await mesh.run({ input_12: meshInput(img, roi) });
          // První průchod jen zpřesní výřez, o přijetí rozhoduje až druhý.
          pts = meshDecode(r.Identity.data, r.Identity_1.data[0], roi, pass === 0 ? 0 : 0.15);
          if (!pts) break;
          roi = roiFromMesh(pts);
        }
        if (pts) faces.push(pts);
        else unsure.push(b);
      }
      return { meshes: faces, unsure };
    } catch (err) {
      console.warn('Obličeje se nepodařilo najít.', err);
      return none;
    }
  }

  /** Vloží do mapy inkoustu detailní kresbu jednoho obličeje. */
  private async faceDetail(crop: RGBA, b: FaceBox, ink: Plane, sx: number, sy: number): Promise<void> {
    const side = Math.max(b.w, b.h) * 1.5;
    const x0 = Math.max(0, Math.round(b.x + b.w / 2 - side / 2));
    const y0 = Math.max(0, Math.round(b.y + b.h / 2 - side / 2));
    const x1 = Math.min(crop.w, Math.round(b.x + b.w / 2 + side / 2));
    const y1 = Math.min(crop.h, Math.round(b.y + b.h / 2 + side / 2));
    if (x1 - x0 < 16 || y1 - y0 < 16) return;
    const part = cropRGBA(crop, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    const { w: fw, h: fh } = lineartSize(part.w, part.h, 320);
    const net = await this.models.lineart();
    const out = await net.run({ input: lineartInput(resizeRGBA(part, fw, fh)) });
    const face = lineartToInk(out.output.data, fw, fh);
    // Zpět do souřadnic kresby s měkkým přechodem k okrajům výřezu.
    const dx0 = Math.floor(x0 * sx);
    const dy0 = Math.floor(y0 * sy);
    const dx1 = Math.min(ink.w, Math.ceil(x1 * sx));
    const dy1 = Math.min(ink.h, Math.ceil(y1 * sy));
    for (let y = dy0; y < dy1; y++) {
      const v = ((y + 0.5) / sy - y0) / (y1 - y0);
      for (let x = dx0; x < dx1; x++) {
        const u = ((x + 0.5) / sx - x0) / (x1 - x0);
        if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
        const edge = Math.min(u, v, 1 - u, 1 - v) / 0.15;
        const val = face.data[Math.min(fh - 1, Math.floor(v * fh)) * fw + Math.min(fw - 1, Math.floor(u * fw))];
        const i = y * ink.w + x;
        ink.data[i] = Math.max(ink.data[i], val * Math.min(1, edge));
      }
    }
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
        // Po přiblížení na postavu jsou textury (srst, látka) větší – vyhladíme víc.
        const k = useSubject ? 1.5 : 1;
        const r = Math.max(1, Math.round(preset.abstract.radius * k * Math.max(w, h)));
        small = abstractImage(small, r, preset.abstract.eps * k, preset.abstract.iterations);
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
      const found = await this.findFaces(crop);
      const sx = w / crop.w;
      const sy = h / crop.h;
      // Obličej z profilu: rysy z bodů kreslit nejde, tak aspoň necháme síť
      // nakreslit obličej zvlášť v plném rozlišení (bez zjednodušení fotky).
      if (!fallback) {
        for (const b of found.unsure) await this.faceDetail(crop, b, ink, sx, sy);
      }
      const faces = found.meshes.map((f) => {
        const out = new Float32Array(f.length);
        for (let i = 0; i < f.length; i += 2) {
          out[i] = f[i] * sx;
          out[i + 1] = f[i + 1] * sy;
        }
        return out;
      });
      const faceBoxes = found.unsure.map((b) => [b.x * sx, b.y * sy, b.w * sx, b.h * sy]);
      cached = { ink, subject, box, fallback, faces, faceBoxes };
      this.inkCache.set(key, cached);
    }
    onStage?.('clean');
    const result = vectorize(cached.ink, {
      level: opts.level,
      detail: opts.detail,
      subject: cached.subject,
      style: opts.style,
      faces: cached.faces,
      faceBoxes: cached.faceBoxes,
    });
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
