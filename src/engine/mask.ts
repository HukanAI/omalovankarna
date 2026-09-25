import type { Mask, Plane } from './types';

const N8X = [-1, 0, 1, -1, 1, -1, 0, 1];
const N8Y = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * Hysterezní práh (jako u Cannyho detektoru): pixel nad `hi` je jistě čára,
 * pixel nad `lo` je čára jen pokud navazuje na jistou čáru. Slabé tahy tak
 * zůstanou souvislé, ale šum na pozadí zmizí.
 */
export function hysteresis(p: Plane, lo: number, hi: number): Mask {
  const { w, h, data } = p;
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i] >= hi) {
      out[i] = 1;
      stack[sp++] = i;
    }
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + N8X[k];
      const ny = y + N8Y[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!out[j] && data[j] >= lo) {
        out[j] = 1;
        stack[sp++] = j;
      }
    }
  }
  return { w, h, data: out };
}

export interface Components {
  labels: Int32Array;
  areas: number[];
  /** Zda komponenta sahá na okraj obrázku. */
  touchesBorder: boolean[];
}

/** Značkování souvislých oblastí (8-okolí pro popředí, 4-okolí pro pozadí). */
export function components(m: Mask, value = 1, conn: 4 | 8 = 8): Components {
  const { w, h, data } = m;
  const labels = new Int32Array(w * h).fill(-1);
  const areas: number[] = [];
  const touchesBorder: boolean[] = [];
  const stack = new Int32Array(w * h);
  const nk = conn === 8 ? 8 : 4;
  const dx = conn === 8 ? N8X : [0, -1, 1, 0];
  const dy = conn === 8 ? N8Y : [-1, 0, 0, 1];
  for (let s = 0; s < w * h; s++) {
    if (labels[s] !== -1 || (data[s] ? 1 : 0) !== value) continue;
    const id = areas.length;
    let area = 0;
    let border = false;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = id;
    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (let k = 0; k < nk; k++) {
        const nx = x + dx[k];
        const ny = y + dy[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (labels[j] === -1 && (data[j] ? 1 : 0) === value) {
          labels[j] = id;
          stack[sp++] = j;
        }
      }
    }
    areas.push(area);
    touchesBorder.push(border);
  }
  return { labels, areas, touchesBorder };
}

export function removeSmall(m: Mask, minArea: number): Mask {
  const { labels, areas } = components(m, 1, 8);
  const out = new Uint8Array(m.data.length);
  for (let i = 0; i < out.length; i++) {
    const l = labels[i];
    out[i] = l >= 0 && areas[l] >= minArea ? 1 : 0;
  }
  return { w: m.w, h: m.h, data: out };
}

/** Zaplní díry v masce (oblasti pozadí, které nesahají na okraj) do dané plochy. */
export function fillHoles(m: Mask, maxArea = Infinity): Mask {
  const { labels, areas, touchesBorder } = components(m, 0, 4);
  const out = m.data.slice();
  for (let i = 0; i < out.length; i++) {
    const l = labels[i];
    if (l >= 0 && !touchesBorder[l] && areas[l] <= maxArea) out[i] = 1;
  }
  return { w: m.w, h: m.h, data: out };
}

/** Ponechá komponenty, které mají aspoň `minFraction` plochy největší z nich. */
export function keepMajor(m: Mask, minFraction = 0.15): Mask {
  const { labels, areas } = components(m, 1, 8);
  if (areas.length <= 1) return m;
  const max = Math.max(...areas);
  const out = new Uint8Array(m.data.length);
  for (let i = 0; i < out.length; i++) {
    const l = labels[i];
    out[i] = l >= 0 && areas[l] >= max * minFraction ? 1 : 0;
  }
  return { w: m.w, h: m.h, data: out };
}

/**
 * Obrysové pixely masky (nastavené pixely se sousedem mimo masku).
 * Okraj obrázku se za obrys nepovažuje – postava useknutá dolním okrajem
 * fotky tak nedostane podél okraje nesmyslnou čáru.
 */
export function boundary(m: Mask): Mask {
  const { w, h, data } = m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!data[i]) continue;
      if (
        (x > 0 && !data[i - 1]) ||
        (x < w - 1 && !data[i + 1]) ||
        (y > 0 && !data[i - w]) ||
        (y < h - 1 && !data[i + w])
      ) {
        out[i] = 1;
      }
    }
  }
  return { w, h, data: out };
}

export function count(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n;
}
