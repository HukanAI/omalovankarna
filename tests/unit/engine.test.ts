import { describe, expect, it } from 'vitest';
import { isoContours, ringArea } from '../../src/engine/contours';
import { components, fillHoles, hysteresis } from '../../src/engine/mask';
import { blur, distanceTransform, fitSize, resizePlane } from '../../src/engine/raster';
import { thin } from '../../src/engine/thin';
import { traceSkeleton } from '../../src/engine/graph';
import { bridgeGaps, simplify } from '../../src/engine/strokes';
import { vectorize } from '../../src/engine/vectorize';
import { rasterizeDrawing } from './raster-helper';
import type { Mask, Plane } from '../../src/engine/types';

/** Mapa inkoustu s kružnicí o poloměru r a tloušťce t; volitelně s mezerou. */
function circleInk(size: number, r: number, t: number, gapDeg = 0): Plane {
  const data = new Float32Array(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const ang = ((Math.atan2(y - c, x - c) * 180) / Math.PI + 360) % 360;
      if (gapDeg && ang < gapDeg) continue;
      data[y * size + x] = Math.max(0, 1 - Math.abs(d - r) / t);
    }
  }
  return { w: size, h: size, data };
}

describe('raster', () => {
  it('fitSize zachová poměr stran a dělitelnost', () => {
    const s = fitSize(1280, 853, 640, 8);
    expect(s.w).toBe(640);
    expect(s.h % 8).toBe(0);
    expect(Math.abs(s.w / s.h - 1280 / 853)).toBeLessThan(0.02);
  });

  it('převzorkování zachová průměrný jas', () => {
    const p: Plane = { w: 100, h: 60, data: new Float32Array(6000).map((_, i) => (i % 7) / 7) };
    const avg = (q: Plane) => q.data.reduce((a, b) => a + b, 0) / q.data.length;
    expect(avg(resizePlane(p, 37, 23))).toBeCloseTo(avg(p), 1);
  });

  it('vzdálenostní transformace je euklidovská', () => {
    const m: Mask = { w: 21, h: 21, data: new Uint8Array(441) };
    m.data[10 * 21 + 10] = 1;
    const d = distanceTransform(m);
    expect(d[10 * 21 + 13]).toBeCloseTo(3);
    expect(d[13 * 21 + 14]).toBeCloseTo(5);
  });
});

describe('maska a kostra', () => {
  it('hystereze drží souvislé slabé tahy a zahodí izolovaný šum', () => {
    const p: Plane = { w: 10, h: 1, data: new Float32Array([0.9, 0.4, 0.4, 0.4, 0, 0, 0.4, 0, 0, 0]) };
    const m = hysteresis(p, 0.3, 0.8);
    expect(Array.from(m.data)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('ztenčení dá z tlusté kružnice jednu uzavřenou smyčku', () => {
    const ink = circleInk(80, 25, 3);
    const bin = hysteresis(ink, 0.3, 0.6);
    const g = traceSkeleton(thin(bin));
    const alive = g.edges.filter((e) => e.alive);
    expect(alive.length).toBe(1);
    expect(alive[0].closed).toBe(true);
    expect(alive[0].len).toBeGreaterThan(2 * Math.PI * 25 * 0.9);
  });

  it('fillHoles zaplní vnitřek kruhu, ale ne okolí', () => {
    const bin = hysteresis(circleInk(60, 20, 2), 0.3, 0.6);
    const filled = fillHoles(bin);
    expect(filled.data[30 * 60 + 30]).toBe(1);
    expect(filled.data[2 * 60 + 2]).toBe(0);
  });
});

describe('obrysy', () => {
  it('izokřivka disku má jednu smyčku se správnou plochou', () => {
    const size = 64;
    const data = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) < 20 ? 1 : 0;
    const rings = isoContours(blur({ w: size, h: size, data }, 1), 0.5);
    expect(rings.length).toBe(1);
    expect(Math.abs(ringArea(rings[0]))).toBeGreaterThan(Math.PI * 400 * 0.95);
    expect(Math.abs(ringArea(rings[0]))).toBeLessThan(Math.PI * 400 * 1.05);
  });

  it('prstenec má vnější i vnitřní obrys', () => {
    const rings = isoContours(circleInk(80, 25, 4), 0.3);
    expect(rings.length).toBe(2);
  });

  it('RDP zjednoduší přímku na dva body', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 20; i++) pts.push(i, i * 0.5);
    expect(simplify(pts, false, 0.1)).toEqual([0, 0, 20, 10]);
  });
});

describe('uzavírání mezer', () => {
  it('dotáhne konec tahu k protější čáře', () => {
    const polys = [
      { pts: [10, 10, 20, 10, 30, 10], closed: false, freeStart: true, freeEnd: true },
      { pts: [36, 0, 36, 10, 36, 20], closed: false, freeStart: true, freeEnd: true },
    ];
    const segs = bridgeGaps(polys, 10, 50, 30);
    expect(segs.some((s) => s[0] === 30 && s[2] === 36)).toBe(true);
  });

  it('kružnice s mezerou se po vektorizaci vybarví bez přetečení', () => {
    const S = 400;
    const ink = circleInk(S, 150, 2.5, 1.5); // mezera ~4 px, po prahování ~9 px
    const { drawing, stats } = vectorize(ink, { level: 'skolaci' });
    expect(stats.bridges).toBeGreaterThan(0);
    const lines = rasterizeDrawing(drawing, S, S);
    const { labels } = components({ w: S, h: S, data: lines.data.map((v) => (v ? 0 : 1)) }, 1, 4);
    // Střed kruhu a roh obrázku musí být v různých oblastech.
    expect(labels[(S / 2) * S + S / 2]).not.toBe(labels[3 * S + 3]);
  });
});
