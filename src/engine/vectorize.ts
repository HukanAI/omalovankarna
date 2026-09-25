import { bridgeGaps, graphToPolys, simplify, smooth } from './strokes';
import { mergeThroughNodes, pruneSpurs, removeShortGroups, removeWeak, traceSkeleton, type Graph } from './graph';
import { boundary, fillHoles, hysteresis, removeSmall } from './mask';
import { blur, distanceTransform, quantile } from './raster';
import { isoContours, ringArea } from './contours';
import { LEVELS, type Level } from './presets';
import { thin } from './thin';
import type { Drawing, Mask, Plane, Stroke } from './types';

export interface VectorizeOptions {
  level: Level;
  /** 0 = méně detailů, 1 = víc detailů; 0.5 odpovídá předvolbě. */
  detail?: number;
  /** Maska hlavního objektu ve stejném rozlišení jako `ink`. */
  subject?: Mask | null;
}

export interface VectorizeResult {
  drawing: Drawing;
  /** Střednice tahů v pořadí kreslení – pro animaci „dokreslování“. */
  reveal: Stroke[];
  stats: { rings: number; strokes: number; bridges: number };
}

const HALF = 0.5; // pixel (x, y) má střed v (x + 0,5, y + 0,5)

/**
 * Z mapy „inkoustu“ (1 = čára, 0 = papír) vytvoří čistou vektorovou omalovánku.
 *
 * 1. Prahování s hysterezí oddělí čáry od šumu.
 * 2. Kostra čar se převede na graf; nad ním se rozhodne, které tahy
 *    jsou podstatné (krátké výběžky, slabé a osamocené tahy pryč).
 * 3. Ponechaný inkoust se převede na hladké obrysy (izokřivky), takže
 *    kresba si drží přirozenou, „ruční“ proměnnou tloušťku čáry.
 * 4. Volné konce tahů se dotáhnou k nejbližší čáře – plochy jsou uzavřené.
 */
export function vectorize(ink: Plane, opts: VectorizeOptions): VectorizeResult {
  const preset = LEVELS[opts.level];
  const detail = Math.min(1, Math.max(0, opts.detail ?? 0.5));
  const { w, h } = ink;
  const L = Math.max(w, h);
  const pxScale = L / preset.size;
  const lenFactor = Math.pow(2, 1 - 2 * detail);
  const thrShift = (0.5 - detail) * 0.12;

  const src = blur(ink, preset.blur * pxScale);
  // Síť kreslí různě „přítlačně“ podle fotky – sjednotíme kontrast čar.
  const peak = Math.max(0.2, quantile(src, 0.995));
  for (let i = 0; i < src.data.length; i++) src.data[i] = Math.min(1, src.data[i] / peak);

  if (opts.subject) {
    // Mimo objekt se nekreslí a těsně u jeho obrysu také ne – obrys
    // nakreslíme zvlášť jednou souvislou čarou, jinak by vznikly dvojité linky.
    const edgeDist = distanceTransform(boundary(opts.subject));
    const inner = 1.2 * pxScale;
    const outer = 4.2 * pxScale;
    for (let i = 0; i < src.data.length; i++) {
      if (!opts.subject.data[i]) src.data[i] = 0;
      else if (edgeDist[i] < outer) src.data[i] *= Math.max(0, (edgeDist[i] - inner) / (outer - inner));
    }
  }

  let bin = hysteresis(src, preset.lo + thrShift, preset.hi + thrShift);
  bin = removeSmall(bin, Math.max(4, (preset.minGroup * lenFactor * L) / 4));

  // ——— Výběr podstatných tahů nad grafem kostry ———
  const skeleton = thin(fillHoles(bin, (preset.holeSize * L) ** 2));
  const graph = traceSkeleton(skeleton);
  pruneSpurs(graph, preset.spur * lenFactor * L, 2);
  removeWeak(graph, src, preset.minStrength * (1 + thrShift), 0.12 * L);
  pruneSpurs(graph, preset.spur * lenFactor * L, 2);
  removeShortGroups(graph, preset.minGroup * lenFactor * L);
  mergeThroughNodes(graph);

  // Typická tloušťka čáry – použije se pro dotažené mezery.
  const lineWidth = medianLineWidth(bin, graph);

  // ——— Inkoust jen v okolí ponechaných tahů → hladké obrysy ———
  const near = distanceTransform(rasterizeGraph(graph, w, h));
  const reach = lineWidth * 0.5 + 1.5 * pxScale;
  const field = new Float32Array(w * h);
  for (let i = 0; i < field.length; i++) {
    if (near[i] <= reach) field[i] = src.data[i];
    else if (near[i] <= reach + 1) field[i] = src.data[i] * (reach + 1 - near[i]);
  }
  const rings: number[][] = [];
  const minArea = Math.max(1.5, (0.8 * pxScale) ** 2 * Math.PI);
  // Jemné rozmazání pole = hladké, „tuší tažené“ okraje čar bez zubů.
  const smoothField = blur({ w, h, data: field }, 0.85 * pxScale);
  for (const raw of isoContours(smoothField, preset.iso)) {
    if (Math.abs(ringArea(raw)) < minArea) continue;
    const simp = simplify(smooth(raw, true, 3), true, 0.2 * pxScale);
    if (simp.length >= 6) rings.push(round(simp));
  }

  // ——— Uzavření mezer ———
  const polys = graphToPolys(graph);
  const bridges = bridgeGaps(polys, preset.gap * L, w, h);
  const strokes: Stroke[] = bridges.map((s) => ({
    pts: round([s[0] + HALF, s[1] + HALF, s[2] + HALF, s[3] + HALF]),
    closed: false,
    weight: 1,
  }));

  // ——— Obrys hlavního objektu jako souvislá, o něco silnější čára ———
  if (opts.subject) {
    const soft = blur(maskToPlane(opts.subject), 1.2 * pxScale);
    for (const ring of isoContours(soft, 0.5)) {
      if (Math.abs(ringArea(ring)) < (0.02 * L) ** 2) continue;
      for (const part of splitAtBorder(smooth(ring, true, 3), w, h)) {
        const pts = simplify(part.pts, part.closed, 0.3 * pxScale);
        if (pts.length >= 4) strokes.push({ pts: round(pts), closed: part.closed, weight: 1.3 });
      }
    }
  }

  // ——— Střednice pro animaci: shora dolů ———
  const reveal: Stroke[] = polys
    .map((p) => {
      const pts = simplify(smooth(p.pts, p.closed, preset.smoothIterations), p.closed, 0.5 * pxScale);
      return { pts: round(pts.map((v) => v + HALF)), closed: p.closed, weight: 1 };
    })
    .filter((s) => s.pts.length >= 4);
  reveal.sort((a, b) => topOf(a) - topOf(b));

  return {
    drawing: { w, h, rings, strokes, lineWidth },
    reveal,
    stats: { rings: rings.length, strokes: strokes.length, bridges: bridges.length },
  };
}

function maskToPlane(m: Mask): Plane {
  const data = new Float32Array(m.data.length);
  for (let i = 0; i < data.length; i++) data[i] = m.data[i];
  return { w: m.w, h: m.h, data };
}

function round(pts: number[]): number[] {
  return pts.map((v) => Math.round(v * 100) / 100);
}

function topOf(s: Stroke): number {
  let m = Infinity;
  for (let i = 1; i < s.pts.length; i += 2) m = Math.min(m, s.pts[i]);
  return m;
}

/** Vykreslí živé hrany grafu do masky (Bresenham). */
function rasterizeGraph(g: Graph, w: number, h: number): Mask {
  const data = new Uint8Array(w * h);
  const plot = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 1;
  };
  for (const e of g.edges) {
    if (!e.alive) continue;
    const n = e.pts.length / 2;
    for (let i = 1; i < (e.closed ? n + 1 : n); i++) {
      let x0 = Math.round(e.pts[((i - 1) % n) * 2]);
      let y0 = Math.round(e.pts[((i - 1) % n) * 2 + 1]);
      const x1 = Math.round(e.pts[(i % n) * 2]);
      const y1 = Math.round(e.pts[(i % n) * 2 + 1]);
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        plot(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }
  }
  return { w, h, data };
}

/** Medián tloušťky čar: dvojnásobek vzdálenosti střednice od okraje čáry. */
function medianLineWidth(bin: Mask, g: Graph): number {
  const bg = new Uint8Array(bin.data.length);
  for (let i = 0; i < bg.length; i++) bg[i] = bin.data[i] ? 0 : 1;
  const dt = distanceTransform({ w: bin.w, h: bin.h, data: bg });
  const samples: number[] = [];
  for (const e of g.edges) {
    if (!e.alive) continue;
    for (let i = 0; i < e.pts.length; i += 6) {
      const x = Math.round(e.pts[i]);
      const y = Math.round(e.pts[i + 1]);
      if (x >= 0 && y >= 0 && x < bin.w && y < bin.h) samples.push(dt[y * bin.w + x]);
    }
  }
  if (!samples.length) return 2;
  samples.sort((a, b) => a - b);
  return Math.max(1.5, samples[samples.length >> 1] * 2 - 0.5);
}

/** Rozdělí uzavřený obrys tam, kde se dotýká okraje obrázku. */
function splitAtBorder(ring: number[], w: number, h: number): { pts: number[]; closed: boolean }[] {
  const n = ring.length / 2;
  const onBorder = (i: number) => {
    const x = ring[i * 2];
    const y = ring[i * 2 + 1];
    return x < 1.5 || y < 1.5 || x > w - 1.5 || y > h - 1.5;
  };
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (onBorder(i)) {
      first = i;
      break;
    }
  }
  if (first === -1) return [{ pts: ring, closed: true }];
  const parts: { pts: number[]; closed: boolean }[] = [];
  let cur: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (onBorder(i)) {
      if (cur.length >= 4) parts.push({ pts: cur, closed: false });
      cur = [];
    } else {
      cur.push(ring[i * 2], ring[i * 2 + 1]);
    }
  }
  if (cur.length >= 4) parts.push({ pts: cur, closed: false });
  return parts;
}
