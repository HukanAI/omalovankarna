import type { TensorIn } from './models';
import type { Level } from './presets';
import type { RGBA, Stroke } from './types';

/*
 * Obličeje: detekce (YuNet, MIT) → 478 bodů obličeje (MediaPipe Face Mesh V2,
 * Apache 2.0). Z bodů se pak kreslí rysy tak, jak je kreslí ilustrátoři
 * omalovánek – oči s duhovkou, obočí jedním tahem, spodek nosu, rty, brada.
 */

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  /** 5 bodů: oči, špička nosu, koutky úst (v pixelech obrázku). */
  kps: number[];
}

export interface Face {
  box: FaceBox;
  /** 478 × (x, y) v pixelech obrázku. */
  pts: Float32Array;
}

// ——— YuNet ———

export const YUNET_SIZE = 640;

/**
 * Vstup detektoru. `fit` < 640 obrázek zmenší a doplní – YuNet umí obličeje
 * zhruba do 300 px, takže detail přes celou fotku najde jen ve zmenšenině.
 */
export function yunetInput(img: RGBA, fit = YUNET_SIZE): { input: TensorIn; scale: number } {
  const S = YUNET_SIZE;
  const scale = Math.min(fit / img.w, fit / img.h);
  const w = Math.round(img.w * scale);
  const h = Math.round(img.h * scale);
  const data = new Float32Array(3 * S * S);
  // Nejbližší soused stačí – detektor je robustní a obrázek se zmenšuje.
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1, Math.floor((x + 0.5) / scale));
      const o = (sy * img.w + sx) * 4;
      // YuNet čeká BGR v rozsahu 0..255.
      data[y * S + x] = img.data[o + 2];
      data[S * S + y * S + x] = img.data[o + 1];
      data[2 * S * S + y * S + x] = img.data[o];
    }
  }
  return { input: { type: 'float32', data, dims: [1, 3, S, S] }, scale };
}

export function yunetDecode(out: Record<string, { data: Float32Array }>, scale: number, threshold = 0.7): FaceBox[] {
  const found: FaceBox[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = out[`cls_${stride}`].data;
    const obj = out[`obj_${stride}`].data;
    const bbox = out[`bbox_${stride}`].data;
    const kps = out[`kps_${stride}`].data;
    const cols = YUNET_SIZE / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < threshold) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cx = (c + bbox[i * 4]) * stride;
      const cy = (r + bbox[i * 4 + 1]) * stride;
      const w = Math.exp(bbox[i * 4 + 2]) * stride;
      const h = Math.exp(bbox[i * 4 + 3]) * stride;
      const k: number[] = [];
      for (let j = 0; j < 5; j++) k.push(((c + kps[i * 10 + j * 2]) * stride) / scale, ((r + kps[i * 10 + j * 2 + 1]) * stride) / scale);
      found.push({ x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, w: w / scale, h: h / scale, score, kps: k });
    }
  }
  return found;
}

/** Potlačení překryvů (NMS) – i mezi výsledky z různých měřítek. */
export function nms(found: FaceBox[]): FaceBox[] {
  found.sort((a, b) => b.score - a.score);
  const keep: FaceBox[] = [];
  for (const f of found) {
    if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  }
  return keep;
}

function iou(a: FaceBox, b: FaceBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// ——— Face Mesh ———

export const MESH_SIZE = 256;

/** Natočený čtvercový výřez: střed, velikost strany a úhel (radiány). */
export interface Roi {
  cx: number;
  cy: number;
  size: number;
  angle: number;
}

export function roiFromBox(b: FaceBox): Roi {
  // kps: 0 = oko vlevo na snímku, 1 = oko vpravo na snímku
  const angle = Math.atan2(b.kps[3] - b.kps[1], b.kps[2] - b.kps[0]);
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, size: Math.max(b.w, b.h) * 1.55, angle };
}

/** Přesnější výřez z bodů prvního průchodu (jako při sledování v MediaPipe). */
export function roiFromMesh(pts: Float32Array): Roi {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 468; i++) {
    x0 = Math.min(x0, pts[i * 2]);
    x1 = Math.max(x1, pts[i * 2]);
    y0 = Math.min(y0, pts[i * 2 + 1]);
    y1 = Math.max(y1, pts[i * 2 + 1]);
  }
  const angle = Math.atan2(pts[263 * 2 + 1] - pts[33 * 2 + 1], pts[263 * 2] - pts[33 * 2]);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0) * 1.5, angle };
}

function roiToImage(roi: Roi, u: number, v: number): [number, number] {
  const lx = (u / MESH_SIZE - 0.5) * roi.size;
  const ly = (v / MESH_SIZE - 0.5) * roi.size;
  const c = Math.cos(roi.angle);
  const s = Math.sin(roi.angle);
  return [roi.cx + c * lx - s * ly, roi.cy + s * lx + c * ly];
}

export function meshInput(img: RGBA, roi: Roi): TensorIn {
  const S = MESH_SIZE;
  const data = new Float32Array(S * S * 3);
  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const [x, y] = roiToImage(roi, u + 0.5, v + 0.5);
      const o = (v * S + u) * 3;
      const x0 = Math.floor(x - 0.5);
      const y0 = Math.floor(y - 0.5);
      const fx = x - 0.5 - x0;
      const fy = y - 0.5 - y0;
      for (let c = 0; c < 3; c++) {
        const px = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= img.w || yy >= img.h ? 0 : img.data[(yy * img.w + xx) * 4 + c];
        const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
        const bot = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
        data[o + c] = (top * (1 - fy) + bot * fy) / 255;
      }
    }
  }
  return { type: 'float32', data, dims: [1, S, S, 3] };
}

/** Výstup sítě (body ve výřezu) → body v obrázku. Null, pokud síť obličej nevidí. */
export function meshDecode(landmarks: Float32Array, presence: number, roi: Roi, minProb = 0.15): Float32Array | null {
  if (1 / (1 + Math.exp(-presence)) < minProb) return null;
  const n = Math.floor(landmarks.length / 3);
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = roiToImage(roi, landmarks[i * 3], landmarks[i * 3 + 1]);
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
  }
  return pts;
}

// ——— Rysy obličeje jako tahy ———

/** Indexy bodů MediaPipe Face Mesh (kanonická topologie). */
export const MESH = {
  eyeR: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  eyeL: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  upperLidR: [33, 246, 161, 160, 159, 158, 157, 173, 133],
  upperLidL: [263, 466, 388, 387, 386, 385, 384, 398, 362],
  irisR: [468, 469, 470, 471, 472],
  irisL: [473, 474, 475, 476, 477],
  // Obočí: horní a dolní okraj, tah vede jejich středem.
  browR: [
    [46, 70],
    [53, 63],
    [52, 105],
    [65, 66],
    [55, 107],
  ],
  browL: [
    [276, 300],
    [283, 293],
    [282, 334],
    [295, 296],
    [285, 336],
  ],
  lipsOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  mouthLine: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  mouthLower: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  noseBottom: [64, 98, 97, 2, 326, 327, 294],
  noseTip: [45, 4, 275],
  jaw: [454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234],
  oval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
    150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
};

// ——— Kreslení rysů ———

export interface FaceArt {
  strokes: Stroke[];
  /** Vyplněné tvary (zorničky) – uzavřené polygony. */
  rings: number[][];
  /** Oblast uvnitř obličeje (pod čelem), kde se čáry sítě nahrazují rysy. */
  region: number[] | null;
}

type Pt = [number, number];

const P = (pts: Float32Array, i: number): Pt => [pts[i * 2], pts[i * 2 + 1]];
const flat = (a: Pt[]) => a.flatMap((p) => p);
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function circle(c: Pt, r: number, n = 20): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push([c[0] + r * Math.cos((i / n) * Math.PI * 2), c[1] + r * Math.sin((i / n) * Math.PI * 2)]);
  return out;
}

/** Souvislé úseky bodů, které splňují podmínku (pro oblouk duhovky pod víčkem). */
function runs(points: Pt[], keep: (p: Pt) => boolean): Pt[][] {
  const n = points.length;
  const flags = points.map(keep);
  if (flags.every(Boolean)) return [points.concat([points[0]])];
  const start = flags.findIndex((f) => !f);
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (flags[i]) cur.push(points[i]);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((r) => r.length >= 3);
}

/**
 * Rysy jednoho obličeje jako tahy omalovánky. `pts` jsou body Face Mesh
 * v souřadnicích kresby, `lineWidth` základní tloušťka čáry kresby.
 */
export function drawFace(pts: Float32Array, lineWidth: number, level: Level): FaceArt {
  const faceW = dist(P(pts, 234), P(pts, 454));
  const empty: FaceArt = { strokes: [], rings: [], region: null };
  // Příliš malý obličej: rysy by splynuly v jednu skvrnu – nechá se kresba sítě.
  if (faceW < lineWidth * 12) return empty;
  // Hlava z profilu: body obličeje už nejsou spolehlivé.
  const yaw = dist(P(pts, 1), P(pts, 234)) / Math.max(1e-6, dist(P(pts, 1), P(pts, 454)));
  if (yaw > 2.6 || yaw < 1 / 2.6) return empty;
  const simple = faceW < lineWidth * 26 || level === 'mali';
  const strokes: Stroke[] = [];
  const rings: number[][] = [];
  const add = (p: Pt[], closed: boolean, weight: number) => {
    if (p.length >= 2) strokes.push({ pts: flat(p), closed, weight });
  };

  for (const side of ['R', 'L'] as const) {
    // Ilustrátoři kreslí oči o něco větší, než jsou na fotce.
    const ec = (side === 'R' ? MESH.eyeR : MESH.eyeL)
      .map((i) => P(pts, i))
      .reduce<Pt>((a, p, _, arr) => [a[0] + p[0] / arr.length, a[1] + p[1] / arr.length], [0, 0]);
    const k = simple ? 1.2 : 1.12;
    const grow = (p: Pt): Pt => [ec[0] + (p[0] - ec[0]) * k, ec[1] + (p[1] - ec[1]) * k];
    const eye = (side === 'R' ? MESH.eyeR : MESH.eyeL).map((i) => grow(P(pts, i)));
    const lid = (side === 'R' ? MESH.upperLidR : MESH.upperLidL).map((i) => grow(P(pts, i)));
    const iris = (side === 'R' ? MESH.irisR : MESH.irisL).map((i) => grow(P(pts, i)));
    const eyeH = dist(P(pts, side === 'R' ? 159 : 386), P(pts, side === 'R' ? 145 : 374)) * k;
    const eyeW = dist(eye[0], eye[8]);
    const open = eyeH > eyeW * 0.14;

    // Horní víčko je silnější a lehce přesahuje do vnějšího koutku (jako u ilustrátorů).
    add(lid, false, 1.15);
    if (open) {
      add(eye.slice(8).concat([eye[0]]), false, 0.75); // spodní víčko
      const center = iris[0];
      const r = (dist(iris[1], iris[3]) + dist(iris[2], iris[4])) / 4;
      if (!simple && r > lineWidth * 1.4) {
        // Duhovka jen tam, kde je vidět mezi víčky.
        for (const arc of runs(circle(center, r, 28), (p) => pointInPoly(p, eye))) add(arc, false, 0.8);
      }
      const pupil = Math.max(lineWidth * 0.9, r * (simple ? 0.55 : 0.42));
      if (pointInPoly(center, eye)) rings.push(flat(circle(center, pupil, 16)));
    }
  }

  // Obočí: tah středem mezi horním a dolním okrajem.
  for (const brow of [MESH.browR, MESH.browL]) {
    add(brow.map(([a, b]) => lerp(P(pts, a), P(pts, b), 0.5)), false, 1.1);
  }

  // Nos: dvě křivky chřípí s mezerou uprostřed, bez hřbetu (jako na referencích).
  const tip = P(pts, 2);
  for (const [wing, nostril] of [
    [64, 98],
    [294, 327],
  ]) {
    const w0 = P(pts, wing);
    const n0 = P(pts, nostril);
    add([lerp(w0, P(pts, wing === 64 ? 48 : 278), 0.35), w0, n0, lerp(n0, tip, 0.45)], false, 0.95);
  }

  // Ústa: čára mezi rty vždy; rty jako plochy k vybarvení u starších dětí.
  const mouthOpen = dist(P(pts, 13), P(pts, 14)) > faceW * 0.03;
  add(MESH.mouthLine.map((i) => P(pts, i)), false, 1.05);
  if (mouthOpen) add(MESH.mouthLower.map((i) => P(pts, i)), false, 1.0);
  const outer = MESH.lipsOuter.map((i) => P(pts, i));
  if (simple) {
    add(outer.slice(11, 20).concat([outer[0]]).slice(1, -1), false, 0.85); // spodní ret obloučkem
  } else {
    add(outer, true, 0.85);
  }

  // Brada a líce – odděluje obličej od krku.
  add(MESH.jaw.map((i) => P(pts, i)), false, 1.0);

  // Oblast nahrazených čar: od čelisti nahoru k obočí (čelo a vlasy zůstanou).
  // Čelist končí u 234 (vlevo na snímku), horní okraj vede nad obočím zleva doprava.
  const top = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300].map((i) => P(pts, i));
  const lift = eyeLift(pts);
  const region = flat([...MESH.jaw.map((i) => P(pts, i)), ...top.map(([x, y]) => [x - lift[0], y - lift[1]] as Pt)]);
  return { strokes, rings, region };
}

/** Posun „nahoru po obličeji“ (kolmo na spojnici očí) o čtvrtinu vzdálenosti oko–obočí. */
function eyeLift(pts: Float32Array): Pt {
  const a = P(pts, 33);
  const b = P(pts, 263);
  const len = dist(a, b) || 1;
  const nx = (b[1] - a[1]) / len;
  const ny = -(b[0] - a[0]) / len;
  const h = dist(P(pts, 159), P(pts, 105)) * 0.35;
  return [-nx * h, -ny * h];
}
