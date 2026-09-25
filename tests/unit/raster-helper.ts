import type { Drawing, Mask } from '../../src/engine/types';

/**
 * Jednoduchý rasterizér kresby pro testy (bez canvasu): obrysy se vyplní
 * pravidlem even-odd po řádcích, tahy se vykreslí jako „kapsle“.
 * Stačí lineární aproximace – testy ověřují topologii, ne vzhled.
 */
export function rasterizeDrawing(d: Drawing, w: number, h: number): Mask {
  const sx = w / d.w;
  const sy = h / d.h;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yy = (y + 0.5) / sy;
    const xs: number[] = [];
    for (const r of d.rings) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const y0 = r[j * 2 + 1];
        const y1 = r[i * 2 + 1];
        if (y0 > yy !== y1 > yy) xs.push(r[j * 2] + ((yy - y0) / (y1 - y0)) * (r[i * 2] - r[j * 2]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] * sx - 0.5)); x < Math.min(w, xs[k + 1] * sx - 0.5); x++) data[y * w + x] = 1;
    }
  }
  for (const s of d.strokes) {
    const rad = (d.lineWidth * s.weight * sx) / 2;
    const n = s.pts.length / 2;
    for (let i = 1; i < (s.closed ? n + 1 : n); i++) {
      const ax = s.pts[((i - 1) % n) * 2] * sx;
      const ay = s.pts[((i - 1) % n) * 2 + 1] * sy;
      const bx = s.pts[(i % n) * 2] * sx;
      const by = s.pts[(i % n) * 2 + 1] * sy;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad - 1));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rad + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad - 1));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rad + 1));
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
          if (Math.hypot(px - ax - t * vx, py - ay - t * vy) <= rad) data[y * w + x] = 1;
        }
      }
    }
  }
  return { w, h, data };
}
