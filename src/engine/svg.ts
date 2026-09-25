import type { Drawing, Stroke } from './types';

const r = (v: number) => Math.round(v * 100) / 100;

/**
 * Lomenou čáru proloží Catmull–Rom splajnem převedeným na kubické
 * Bézierovy křivky – čára je plynulá i při velkém zvětšení nebo tisku.
 */
export function curvePath(p: number[], closed: boolean, scale = 1, ox = 0, oy = 0): string {
  const n = p.length / 2;
  const X = (i: number) => p[i * 2] * scale + ox;
  const Y = (i: number) => p[i * 2 + 1] * scale + oy;
  if (n === 1) return `M${r(X(0))} ${r(Y(0))}h0`;
  if (n === 2) return `M${r(X(0))} ${r(Y(0))}L${r(X(1))} ${r(Y(1))}`;
  const idx = (i: number) => (closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i)));
  let d = `M${r(X(0))} ${r(Y(0))}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i0 = idx(i - 1);
    const i1 = idx(i);
    const i2 = idx(i + 1);
    const i3 = idx(i + 2);
    const c1x = X(i1) + (X(i2) - X(i0)) / 6;
    const c1y = Y(i1) + (Y(i2) - Y(i0)) / 6;
    const c2x = X(i2) - (X(i3) - X(i1)) / 6;
    const c2y = Y(i2) - (Y(i3) - Y(i1)) / 6;
    d += `C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(X(i2))} ${r(Y(i2))}`;
  }
  if (closed) d += 'Z';
  return d;
}

export function strokePath(s: Stroke, scale = 1, ox = 0, oy = 0): string {
  return curvePath(s.pts, s.closed, scale, ox, oy);
}

/** Všechny obrysy inkoustu jako jedna cesta (vyplňuje se pravidlem even-odd). */
export function ringsPath(d: Drawing, scale = 1, ox = 0, oy = 0): string {
  let out = '';
  for (const ring of d.rings) out += curvePath(ring, true, scale, ox, oy);
  return out;
}

/** Tahy seskupené podle tloušťky (jedna cesta na tloušťku). */
export function strokeGroups(d: Drawing, scale = 1, ox = 0, oy = 0): { width: number; d: string }[] {
  const groups = new Map<number, string>();
  for (const s of d.strokes) groups.set(s.weight, (groups.get(s.weight) ?? '') + strokePath(s, scale, ox, oy));
  return [...groups].map(([weight, path]) => ({ width: r(d.lineWidth * weight * scale), d: path }));
}

export interface SvgOptions {
  /** Výsledná šířka v px (výška dle poměru stran). */
  width?: number;
  background?: string | null;
  color?: string;
}

export function drawingToSvg(d: Drawing, opts: SvgOptions = {}): string {
  const width = opts.width ?? d.w;
  const scale = width / d.w;
  const height = Math.round(d.h * scale);
  const color = opts.color ?? '#1d1a17';
  const bg = opts.background === null ? '' : `<rect width="100%" height="100%" fill="${opts.background ?? '#fff'}"/>`;
  const strokes = strokeGroups(d, scale)
    .map((g) => `<path d="${g.d}" stroke-width="${g.width}"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    bg +
    `<path d="${ringsPath(d, scale)}" fill="${color}" fill-rule="evenodd"/>` +
    `<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">${strokes}</g></svg>`
  );
}
