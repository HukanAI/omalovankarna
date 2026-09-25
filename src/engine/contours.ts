import type { Plane } from './types';

/**
 * Izokřivky skalárního pole (marching squares s lineární interpolací).
 * Vrací uzavřené polygony se subpixelovou přesností – obrysy čar jsou tak
 * hladké i bez převzorkování. Souřadnice odpovídají středům pixelů (+0,5).
 */
export function isoContours(field: Plane, t: number): number[][] {
  const W = field.w + 2;
  const H = field.h + 2;
  // Okraj z nul zajistí, že se každá křivka uzavře.
  const f = new Float32Array(W * H);
  for (let y = 0; y < field.h; y++) {
    f.set(field.data.subarray(y * field.w, (y + 1) * field.w), (y + 1) * W + 1);
  }

  const hId = (x: number, y: number) => y * W + x;
  const vId = (x: number, y: number) => W * H + y * W + x;
  const pointOn = (id: number): [number, number] => {
    if (id < W * H) {
      const x = id % W;
      const y = (id / W) | 0;
      const v0 = f[y * W + x];
      const v1 = f[y * W + x + 1];
      return [x + (t - v0) / (v1 - v0) - 0.5, y - 0.5];
    }
    const j = id - W * H;
    const x = j % W;
    const y = (j / W) | 0;
    const v0 = f[y * W + x];
    const v1 = f[(y + 1) * W + x];
    return [x - 0.5, y + (t - v0) / (v1 - v0) - 0.5];
  };

  const segA: number[] = [];
  const segB: number[] = [];
  const add = (a: number, b: number) => {
    segA.push(a);
    segB.push(b);
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = f[y * W + x];
      const b = f[y * W + x + 1];
      const c = f[(y + 1) * W + x + 1];
      const d = f[(y + 1) * W + x];
      const code = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = hId(x, y);
      const B = hId(x, y + 1);
      const L = vId(x, y);
      const R = vId(x + 1, y);
      const center = (a + b + c + d) / 4 > t;
      switch (code) {
        case 1: add(L, B); break;
        case 2: add(B, R); break;
        case 3: add(L, R); break;
        case 4: add(T, R); break;
        case 5:
          if (center) { add(L, T); add(B, R); } else { add(T, R); add(L, B); }
          break;
        case 6: add(T, B); break;
        case 7: add(T, L); break;
        case 8: add(L, T); break;
        case 9: add(T, B); break;
        case 10:
          if (center) { add(T, R); add(L, B); } else { add(L, T); add(B, R); }
          break;
        case 11: add(T, R); break;
        case 12: add(L, R); break;
        case 13: add(B, R); break;
        case 14: add(L, B); break;
      }
    }
  }

  // Každá hrana mřížky patří nejvýš dvěma úsečkám (z obou sousedních buněk).
  const byEdge = new Map<number, number[]>();
  const link = (e: number, s: number) => {
    const l = byEdge.get(e);
    if (l) l.push(s);
    else byEdge.set(e, [s]);
  };
  for (let s = 0; s < segA.length; s++) {
    link(segA[s], s);
    link(segB[s], s);
  }

  const used = new Uint8Array(segA.length);
  const rings: number[][] = [];
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const start = segA[s0];
    let edge = segB[s0];
    const ring: number[] = [...pointOn(start)];
    let guard = segA.length + 1;
    while (edge !== start && guard-- > 0) {
      ring.push(...pointOn(edge));
      const cand = byEdge.get(edge)!;
      const next = cand.find((s) => !used[s]);
      if (next === undefined) break;
      used[next] = 1;
      edge = segA[next] === edge ? segB[next] : segA[next];
    }
    if (ring.length >= 6) rings.push(ring);
  }
  return rings;
}

/** Orientovaná plocha polygonu (kladná = po směru hodinových ručiček v souřadnicích obrazovky). */
export function ringArea(r: number[]): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (r[j * 2] + r[i * 2]) * (r[j * 2 + 1] - r[i * 2 + 1]);
  return a / 2;
}
