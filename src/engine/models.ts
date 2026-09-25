import { blur, fitSize, luminance, resizePlane, resizeRGBA, toCHW } from './raster';
import { fillHoles, keepMajor } from './mask';
import type { Mask, Plane, RGBA } from './types';

/*
 * Pre- a post-processing pro modely. Samotné spouštění (onnxruntime-web
 * v prohlížeči, onnxruntime-node v testech) je mimo tento soubor, takže
 * logika je stejná všude a dá se testovat.
 */

export interface TensorIn {
  type: 'float32' | 'int64';
  data: Float32Array | BigInt64Array;
  dims: number[];
}

// ——— Kreslicí síť (Informative Drawings) ———

export function lineartSize(w: number, h: number, longSide: number) {
  // Generátor dvakrát podvzorkuje, rozměry musí být dělitelné 4 (volíme 8).
  return fitSize(w, h, longSide, 8);
}

export function lineartInput(img: RGBA): TensorIn {
  return { type: 'float32', data: toCHW(img), dims: [1, 3, img.h, img.w] };
}

/** Výstup sítě (1 = papír) → mapa inkoustu (1 = čára). */
export function lineartToInk(out: Float32Array, w: number, h: number): Plane {
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, Math.max(0, 1 - out[i]));
  return { w, h, data };
}

// ——— Záložní klasický detektor hran (XDoG, Winnemöller 2012) ———

export function xdogInk(img: RGBA): Plane {
  const lum = luminance(img);
  const L = Math.max(img.w, img.h);
  const sigma = Math.max(0.8, L / 700);
  const g1 = blur(lum, sigma);
  const g2 = blur(lum, sigma * 1.6);
  const tau = 0.985;
  const eps = -0.004;
  const phi = 90;
  const data = new Float32Array(lum.data.length);
  for (let i = 0; i < data.length; i++) {
    const d = g1.data[i] - tau * g2.data[i];
    data[i] = d >= eps ? 0 : Math.min(1, -Math.tanh(phi * (d - eps)));
  }
  return { w: img.w, h: img.h, data };
}

// ——— SlimSAM: výběr objektu klepnutím ———

export const SAM_SIZE = 1024;
const SAM_MEAN = [0.485, 0.456, 0.406];
const SAM_STD = [0.229, 0.224, 0.225];

export interface SamPrepared {
  input: TensorIn;
  /** Rozměry obrázku po zmenšení na 1024 (před doplněním). */
  rw: number;
  rh: number;
  scale: number;
}

export function samPreprocess(img: RGBA): SamPrepared {
  const { w: rw, h: rh } = fitSize(img.w, img.h, SAM_SIZE);
  const resized = resizeRGBA(img, rw, rh);
  const chw = toCHW(resized, SAM_MEAN, SAM_STD);
  const padded = new Float32Array(3 * SAM_SIZE * SAM_SIZE);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < rh; y++) {
      padded.set(chw.subarray(c * rw * rh + y * rw, c * rw * rh + (y + 1) * rw), c * SAM_SIZE * SAM_SIZE + y * SAM_SIZE);
    }
  }
  return {
    input: { type: 'float32', data: padded, dims: [1, 3, SAM_SIZE, SAM_SIZE] },
    rw,
    rh,
    scale: rw / img.w,
  };
}

export interface SamPoint {
  /** Souřadnice v 0..1 vzhledem k obrázku. */
  x: number;
  y: number;
  /** true = patří k objektu, false = nepatří. */
  positive: boolean;
}

export function samPromptInputs(points: SamPoint[], prep: SamPrepared): { points: TensorIn; labels: TensorIn } {
  const n = points.length;
  const pts = new Float32Array(n * 2);
  const labels = new BigInt64Array(n);
  points.forEach((p, i) => {
    pts[i * 2] = p.x * prep.rw;
    pts[i * 2 + 1] = p.y * prep.rh;
    labels[i] = p.positive ? 1n : 0n;
  });
  return {
    points: { type: 'float32', data: pts, dims: [1, 1, n, 2] },
    labels: { type: 'int64', data: labels, dims: [1, 1, n] },
  };
}

/**
 * Z nízkého rozlišení (3 × 256²) vybere nejlepší masku, převzorkuje ji
 * na cílovou velikost a uhladí okraje.
 * U automatického výběru (jediný bod) dá přednost největší masce s dobrým
 * skóre – tedy celému objektu, ne jen jeho části (zip bundy, ucho…).
 */
export function samMask(
  pred: Float32Array,
  iou: Float32Array,
  prep: SamPrepared,
  outW: number,
  outH: number,
  singlePoint: boolean,
): { mask: Mask; score: number } {
  const low = 256;
  const plane = low * low;
  const cw = Math.max(1, Math.round((prep.rw / SAM_SIZE) * low));
  const ch = Math.max(1, Math.round((prep.rh / SAM_SIZE) * low));
  const area = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) if (pred[k * plane + y * low + x] > 0) area[k]++;
    }
  }
  const total = cw * ch;
  let best = 0;
  for (let k = 1; k < 3; k++) if (iou[k] > iou[best]) best = k;
  if (singlePoint) {
    const maxIou = iou[best];
    for (let k = 0; k < 3; k++) {
      const frac = area[k] / total;
      if (iou[k] >= maxIou - 0.15 && frac < 0.85 && area[k] > area[best]) best = k;
    }
  }
  // Oříznutí doplněné části (obrázek leží vlevo nahoře v 1024²).
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    crop.set(pred.subarray(best * plane + y * low, best * plane + y * low + cw), y * cw);
  }
  const up = resizePlane({ w: cw, h: ch, data: crop }, outW, outH);
  const soft = blur(up, Math.max(outW, outH) / 400);
  const data = new Uint8Array(outW * outH);
  for (let i = 0; i < data.length; i++) data[i] = soft.data[i] > 0 ? 1 : 0;
  let mask: Mask = { w: outW, h: outH, data };
  mask = keepMajor(mask, 0.12);
  mask = fillHoles(mask, outW * outH * 0.01);
  return { mask, score: iou[best] };
}

// ——— Ořez na objekt ———

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Obdélník kolem masky (v jejích pixelech) s okrajem; null pro prázdnou masku. */
export function maskBox(m: Mask, margin: number): Box | null {
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.data[y * m.w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * margin);
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(m.w, x1 + pad + 1) - x, h: Math.min(m.h, y1 + pad + 1) - y };
}

export function cropRGBA(img: RGBA, b: Box): RGBA {
  const out = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) {
    out.set(img.data.subarray(((b.y + y) * img.w + b.x) * 4, ((b.y + y) * img.w + b.x + b.w) * 4), y * b.w * 4);
  }
  return { w: b.w, h: b.h, data: out };
}
