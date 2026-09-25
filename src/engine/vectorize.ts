import { bridgeGaps, graphToPolys, polyLength, resample, simplify, smooth, smoothGaussian, type Poly } from './strokes';
import { mergeThroughNodes, pruneSpurs, removeShortGroups, removeWeak, restoreConnectors, traceSkeleton, type Graph } from './graph';
import { boundary, components, fillHoles, hysteresis, removeSmall } from './mask';
import { blur, distanceTransform, quantile } from './raster';
import { isoContours, ringArea } from './contours';
import { LEVELS, PRINT_LONG_MM, type Level } from './presets';
import { thin } from './thin';
import type { Drawing, Mask, Plane, Stroke } from './types';

export interface VectorizeOptions {
  level: Level;
  /** 0 = méně detailů, 1 = víc detailů; 0.5 odpovídá předvolbě. */
  detail?: number;
  /** Maska hlavního objektu ve stejném rozlišení jako `ink`. */
  subject?: Mask | null;
  /**
   * 'pen' = souvislé tahy jednotné tloušťky (jako tištěné omalovánky),
   * 'ink' = obrysy inkoustu s proměnnou tloušťkou (jako kresba tuší).
   */
  style?: 'pen' | 'ink';
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
    const outer = 5.5 * pxScale;
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
  restoreConnectors(graph, 0.08 * L);
  mergeThroughNodes(graph);

  // Typická tloušťka čáry – použije se pro dotažené mezery.
  const lineWidth = medianLineWidth(bin, graph);

  // ——— Drobné výrazné tvary (oči, čumáček, knoflíky) ———
  // Mají krátkou kostru, takže by je filtr tahů smazal – přitom nesou výraz.
  const features = findFeatures(bin, src, L);

  if ((opts.style ?? 'pen') === 'pen') {
    return penDrawing(graph, features, src, opts, preset, w, h, L, pxScale);
  }

  // ——— Inkoust jen v okolí ponechaných tahů → hladké obrysy ———
  const kept = rasterizeGraph(graph, w, h);
  for (let i = 0; i < kept.data.length; i++) if (features[i]) kept.data[i] = 1;
  const near = distanceTransform(kept);
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
    .filter((s) => s.pts.length >= 4)
    .concat(strokes.filter((s) => s.weight > 1));
  reveal.sort((a, b) => topOf(a) - topOf(b));

  return {
    drawing: { w, h, rings, strokes, lineWidth },
    reveal,
    stats: { rings: rings.length, strokes: strokes.length, bridges: bridges.length },
  };
}

/**
 * Perový styl: každý tah je souvislá, hladká čára jednotné tloušťky.
 * Kostra se převzorkuje a vyhladí Gaussovým filtrem podél tahu, takže
 * zmizí pixelové zuby i drobné roztřesení, a konce se dotáhnou k sousedním čarám.
 */
function penDrawing(
  graph: Graph,
  features: Uint8Array,
  src: Plane,
  opts: VectorizeOptions,
  preset: (typeof LEVELS)[Level],
  w: number,
  h: number,
  L: number,
  pxScale: number,
): VectorizeResult {
  const lineWidth = (preset.lineMm * L) / PRINT_LONG_MM;
  const step = 1.5 * pxScale;
  let polys: Poly[] = graphToPolys(graph);

  // Obrys hlavního objektu nahrazuje čáry sítě, které vedou těsně podél něj
  // (jinak vzniká dvojitý obrys). Vnitřní čáry se k němu pak dotáhnou.
  let outline: Poly[] = [];
  if (opts.subject) {
    outline = subjectOutline(opts.subject, w, h, L, pxScale, step);
    const edgeDist = distanceTransform(boundary(opts.subject));
    polys = trimNear(polys, edgeDist, w, h, 7.5 * pxScale, preset.spur * L);
    // Krátké úlomky, které jen kopírují obrys o kus dál, by vytvořily úzké
    // kapsy, které se špatně vybarvují.
    polys = polys.filter((p) => !hugsOutline(p, edgeDist, w, h, 16 * pxScale, 0.18 * L));
  }

  const all = polys.concat(outline);
  const bridges = bridgeGaps(all, preset.gap * L, w, h);

  // Vyhlazení v bodech podél tahu: silnější pro menší děti (klidnější linky).
  const sigma = (preset.penSmooth * pxScale) / step;
  const strokes: Stroke[] = [];
  for (const p of polys) {
    const even = resample(p.pts, p.closed, step);
    const sm = smoothGaussian(even, p.closed, sigma);
    const pts = simplify(sm, p.closed, 0.18 * pxScale);
    if (pts.length < 4) continue;
    strokes.push({ pts: round(pts.map((v) => v + HALF)), closed: p.closed, weight: 1 });
  }
  for (const o of outline) {
    const pts = simplify(o.pts, o.closed, 0.2 * pxScale);
    if (pts.length >= 4) strokes.push({ pts: round(pts.map((v) => v + HALF)), closed: o.closed, weight: 1.35 });
  }

  // Oči, čumáčky a podobně zůstávají vyplněné.
  const rings: number[][] = [];
  const featureField = new Float32Array(w * h);
  let anyFeature = false;
  for (let i = 0; i < features.length; i++) {
    if (features[i]) {
      featureField[i] = src.data[i];
      anyFeature = true;
    }
  }
  if (anyFeature) {
    const f = blur({ w, h, data: featureField }, 0.9 * pxScale);
    for (const raw of isoContours(f, 0.35)) {
      if (Math.abs(ringArea(raw)) < (1.2 * pxScale) ** 2 * Math.PI) continue;
      const simp = simplify(smoothGaussian(resample(raw, true, step), true, 1.2), true, 0.15 * pxScale);
      if (simp.length >= 6) rings.push(round(simp));
    }
  }

  const reveal = strokes.slice().sort((a, b) => topOf(a) - topOf(b));
  return {
    drawing: { w, h, rings, strokes, lineWidth },
    reveal,
    stats: { rings: rings.length, strokes: strokes.length, bridges: bridges.length },
  };
}

function hugsOutline(p: Poly, edgeDist: Float32Array, w: number, h: number, dist: number, maxLen: number): boolean {
  if (p.closed || polyLength(p.pts) > maxLen) return false;
  let near = 0;
  const n = p.pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x = Math.min(w - 1, Math.max(0, Math.round(p.pts[i * 2])));
    const y = Math.min(h - 1, Math.max(0, Math.round(p.pts[i * 2 + 1])));
    if (edgeDist[y * w + x] < dist) near++;
  }
  return near / n > 0.7;
}

/**
 * Odstraní části tahů, které leží blíž než `dist` k obrysu objektu.
 * Zbylé kusy kratší než `minLen` zahodí; nové konce jsou volné (dotáhnou se).
 */
function trimNear(polys: Poly[], edgeDist: Float32Array, w: number, h: number, dist: number, minLen: number): Poly[] {
  const out: Poly[] = [];
  const near = (x: number, y: number) =>
    edgeDist[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))] < dist;
  for (const p of polys) {
    const n = p.pts.length / 2;
    let run: number[] = [];
    let runStart = 0;
    const flush = (endIdx: number) => {
      if (run.length >= 4 && polyLength(run) >= minLen) {
        const whole = runStart === 0 && endIdx === n - 1;
        out.push({
          pts: run,
          closed: whole && p.closed,
          freeStart: runStart === 0 ? p.freeStart : true,
          freeEnd: endIdx === n - 1 ? p.freeEnd : true,
        });
      }
      run = [];
    };
    for (let i = 0; i < n; i++) {
      const x = p.pts[i * 2];
      const y = p.pts[i * 2 + 1];
      if (near(x, y)) {
        if (run.length) flush(i - 1);
        runStart = i + 1;
      } else {
        if (!run.length) runStart = i;
        run.push(x, y);
      }
    }
    if (run.length) flush(n - 1);
  }
  return out;
}

/** Obrys hlavního objektu jako souvislá čára (souřadnice pixelů, bez posunu +0,5). */
function subjectOutline(subject: Mask, w: number, h: number, L: number, pxScale: number, step: number): Poly[] {
  const out: Poly[] = [];
  const soft = blur(maskToPlane(subject), 1.4 * pxScale);
  for (const ring of isoContours(soft, 0.5)) {
    if (Math.abs(ringArea(ring)) < (0.02 * L) ** 2) continue;
    const even = smoothGaussian(resample(ring, true, step), true, (2.2 * pxScale) / step);
    for (const part of splitAtBorder(even, w, h)) {
      if (part.pts.length < 4) continue;
      out.push({ pts: part.pts.map((v) => v - HALF), closed: part.closed, freeStart: false, freeEnd: false });
    }
  }
  return out;
}

/**
 * Kompaktní, sytě kreslené skvrny střední velikosti – typicky oči a nos.
 * Vrací masku jejich pixelů.
 */
function findFeatures(bin: Mask, strength: Plane, L: number): Uint8Array {
  const { labels, areas } = components(bin, 1, 8);
  const n = areas.length;
  const x0 = new Float64Array(n).fill(Infinity);
  const y0 = new Float64Array(n).fill(Infinity);
  const x1 = new Float64Array(n).fill(-Infinity);
  const y1 = new Float64Array(n).fill(-Infinity);
  const sum = new Float64Array(n);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const x = i % bin.w;
    const y = (i / bin.w) | 0;
    if (x < x0[l]) x0[l] = x;
    if (x > x1[l]) x1[l] = x;
    if (y < y0[l]) y0[l] = y;
    if (y > y1[l]) y1[l] = y;
    sum[l] += strength.data[i];
  }
  const keep = new Uint8Array(n);
  const minArea = (0.006 * L) ** 2;
  const maxSize = 0.07 * L;
  for (let l = 0; l < n; l++) {
    const bw = x1[l] - x0[l] + 1;
    const bh = y1[l] - y0[l] + 1;
    const fill = areas[l] / (bw * bh);
    const aspect = Math.max(bw, bh) / Math.min(bw, bh);
    if (areas[l] >= minArea && Math.max(bw, bh) <= maxSize && aspect < 3 && fill > 0.3 && sum[l] / areas[l] > 0.55) {
      keep[l] = 1;
    }
  }
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && keep[labels[i]]) out[i] = 1;
  return out;
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
