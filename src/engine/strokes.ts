import { degree, polyLength, type Graph } from './graph';

export interface Poly {
  pts: number[];
  closed: boolean;
  /** Zda je začátek / konec volný (nenavazuje na jiný tah). */
  freeStart: boolean;
  freeEnd: boolean;
}

export function graphToPolys(g: Graph): Poly[] {
  const out: Poly[] = [];
  for (const e of g.edges) {
    if (!e.alive) continue;
    out.push({
      pts: e.pts.slice(),
      closed: e.closed,
      freeStart: !e.closed && degree(g, e.a) === 1,
      freeEnd: !e.closed && degree(g, e.b) === 1,
    });
  }
  return out;
}

/** Bod na lomené čáře ve vzdálenosti `dist` od začátku (nebo konce). */
function pointBack(pts: number[], fromEnd: boolean, dist: number): [number, number] {
  const n = pts.length / 2;
  let acc = 0;
  for (let k = 1; k < n; k++) {
    const i = fromEnd ? n - 1 - k : k;
    const j = fromEnd ? i + 1 : i - 1;
    acc += Math.hypot(pts[i * 2] - pts[j * 2], pts[i * 2 + 1] - pts[j * 2 + 1]);
    if (acc >= dist) return [pts[i * 2], pts[i * 2 + 1]];
  }
  return fromEnd ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
}

/**
 * Uzavírání mezer: volný konec tahu se prodlouží k nejbližší čáře, na kterou
 * „míří“ (případně k okraji obrázku). Díky tomu vzniknou uzavřené plochy,
 * které jde vybarvit kyblíkem bez přetékání.
 */
export function bridgeGaps(polys: Poly[], radius: number, w: number, h: number): number[][] {
  if (radius <= 0) return [];
  const cell = Math.max(4, radius);
  const gw = Math.ceil(w / cell) + 1;
  const gh = Math.ceil(h / cell) + 1;
  const grid = new Map<number, number[]>(); // klíč buňky → [poly, index bodu, oblouková délka]…
  const arcs: Float32Array[] = [];
  polys.forEach((p, pi) => {
    const n = p.pts.length / 2;
    const arc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (i > 0) arc[i] = arc[i - 1] + Math.hypot(p.pts[i * 2] - p.pts[i * 2 - 2], p.pts[i * 2 + 1] - p.pts[i * 2 - 1]);
      const key = Math.floor(p.pts[i * 2 + 1] / cell) * gw + Math.floor(p.pts[i * 2] / cell);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(pi, i);
    }
    arcs.push(arc);
  });

  const consumed = new Set<string>();
  // Prodloužení se aplikují až nakonec, aby se během hledání neposouvaly indexy bodů.
  const apply: [Poly, boolean, number, number][] = [];
  const cosWide = Math.cos((62 * Math.PI) / 180);

  polys.forEach((p, pi) => {
    for (const atEnd of [false, true]) {
      if (atEnd ? !p.freeEnd : !p.freeStart) continue;
      if (consumed.has(`${pi}:${atEnd ? 1 : 0}`)) continue;
      const n = p.pts.length / 2;
      const ei = atEnd ? n - 1 : 0;
      const ex = p.pts[ei * 2];
      const ey = p.pts[ei * 2 + 1];
      const total = arcs[pi][n - 1];
      const [bx, by] = pointBack(p.pts, atEnd, Math.min(radius * 0.6, total * 0.5));
      let dx = ex - bx;
      let dy = ey - by;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;

      let best = -1;
      let bestScore = Infinity;
      let bestX = 0;
      let bestY = 0;
      let bestTarget = '';
      const cx = Math.floor(ex / cell);
      const cy = Math.floor(ey / cell);
      for (let yy = cy - 1; yy <= cy + 1; yy++) {
        if (yy < 0 || yy >= gh) continue;
        for (let xx = cx - 1; xx <= cx + 1; xx++) {
          if (xx < 0 || xx >= gw) continue;
          const list = grid.get(yy * gw + xx);
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            const qi = list[k];
            const qj = list[k + 1];
            if (qi === pi) {
              // Vlastní tah jen pokud je po oblouku dost daleko (uzavření smyčky).
              const along = Math.abs(arcs[pi][qj] - arcs[pi][ei]);
              if (along < radius * 3) continue;
            }
            const q = polys[qi];
            const vx = q.pts[qj * 2] - ex;
            const vy = q.pts[qj * 2 + 1] - ey;
            const d = Math.hypot(vx, vy);
            if (d < 0.75 || d > radius) continue;
            const cos = (vx * dx + vy * dy) / d;
            if (cos < cosWide && !(d < radius * 0.35 && cos > -0.25)) continue;
            const score = d * (1.7 - cos);
            if (score < bestScore) {
              bestScore = score;
              best = qi;
              bestX = q.pts[qj * 2];
              bestY = q.pts[qj * 2 + 1];
              const qn = q.pts.length / 2;
              bestTarget = qj === 0 && q.freeStart ? `${qi}:0` : qj === qn - 1 && q.freeEnd ? `${qi}:1` : '';
            }
          }
        }
      }

      // Okraj obrázku funguje jako rám – i k němu se dá tah dotáhnout.
      const borders: [number, number, number][] = [
        [ex, dx < 0 ? ex / -dx : Infinity, 0],
        [w - 1 - ex, dx > 0 ? (w - 1 - ex) / dx : Infinity, 1],
        [ey, dy < 0 ? ey / -dy : Infinity, 2],
        [h - 1 - ey, dy > 0 ? (h - 1 - ey) / dy : Infinity, 3],
      ];
      for (const [perp, along, side] of borders) {
        if (perp > radius * 0.7 || along > radius * 1.2 || perp < 0.5) continue;
        const cos = perp / along;
        const score = perp * (1.7 - cos);
        if (score < bestScore) {
          bestScore = score;
          best = -2;
          bestX = side === 0 ? 0 : side === 1 ? w - 1 : ex + dx * along;
          bestY = side === 2 ? 0 : side === 3 ? h - 1 : ey + dy * along;
          bestTarget = '';
        }
      }

      if (best === -1) continue;
      apply.push([p, atEnd, bestX, bestY]);
      if (bestTarget) consumed.add(bestTarget);
    }
  });
  const segments: number[][] = [];
  for (const [p, atEnd, x, y] of apply) {
    const n = p.pts.length;
    if (atEnd) {
      segments.push([p.pts[n - 2], p.pts[n - 1], x, y]);
      p.pts.push(x, y);
      p.freeEnd = false;
    } else {
      segments.push([p.pts[0], p.pts[1], x, y]);
      p.pts.unshift(x, y);
      p.freeStart = false;
    }
  }
  return segments;
}

/**
 * Taubinovo vyhlazení (λ|μ): odstraní pixelové schody, ale na rozdíl
 * od prostého průměrování tah nezkracuje ani „nevyhlazuje do ztracena“.
 */
export function smooth(pts: number[], closed: boolean, iterations: number): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  let cur = pts.slice();
  let next = new Array<number>(pts.length);
  const step = (f: number) => {
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        next[i * 2] = cur[i * 2];
        next[i * 2 + 1] = cur[i * 2 + 1];
        continue;
      }
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      for (let c = 0; c < 2; c++) {
        const mid = (cur[a * 2 + c] + cur[b * 2 + c]) / 2;
        next[i * 2 + c] = cur[i * 2 + c] + f * (mid - cur[i * 2 + c]);
      }
    }
    [cur, next] = [next, cur];
  };
  for (let k = 0; k < iterations; k++) {
    step(0.5);
    step(-0.53);
  }
  return cur;
}

/** Ramer–Douglas–Peucker. */
export function simplify(pts: number[], closed: boolean, eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const src = closed ? pts.concat(pts[0], pts[1]) : pts;
  const m = src.length / 2;
  const keep = new Uint8Array(m);
  keep[0] = keep[m - 1] = 1;
  const stack: [number, number][] = [[0, m - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = src[a * 2];
    const ay = src[a * 2 + 1];
    const bx = src[b * 2];
    const by = src[b * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = src[i * 2];
      const py = src[i * 2 + 1];
      const d =
        len < 1e-6
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  const last = closed ? m - 1 : m;
  for (let i = 0; i < last; i++) if (keep[i]) out.push(src[i * 2], src[i * 2 + 1]);
  if (closed && out.length < 6) return pts.slice();
  return out;
}

export { polyLength };
