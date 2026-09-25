import type { Mask } from './types';

/**
 * Ztenčení čar na jednopixelovou střednici (Zhang–Suen 1984)
 * a následné odstranění rohových pixelů, aby střednice byla
 * striktně 8-souvislá a každý vnitřní pixel měl právě dva sousedy.
 */
export function thin(m: Mask): Mask {
  const w = m.w + 2;
  const h = m.h + 2;
  // Rámeček o šířce 1 px zjednoduší práci se sousedy.
  const img = new Uint8Array(w * h);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) img[(y + 1) * w + x + 1] = m.data[y * m.w + x] ? 1 : 0;
  }

  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const p2 = img[i - w];
          const p3 = img[i - w + 1];
          const p4 = img[i + 1];
          const p5 = img[i + w + 1];
          const p6 = img[i + w];
          const p7 = img[i + w - 1];
          const p8 = img[i - 1];
          const p9 = img[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const a =
            (+(!p2 && p3)) +
            (+(!p3 && p4)) +
            (+(!p4 && p5)) +
            (+(!p5 && p6)) +
            (+(!p6 && p7)) +
            (+(!p7 && p8)) +
            (+(!p8 && p9)) +
            (+(!p9 && p2));
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          }
          del.push(i);
        }
      }
      if (del.length) {
        changed = true;
        for (const i of del) img[i] = 0;
      }
    }
  }

  // Odstranění „schodů“: pixel v rohu L je zbytečný, pokud jeho dva
  // ortogonální sousedé na sebe navazují diagonálně.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!img[i]) continue;
      const n = img[i - w];
      const e = img[i + 1];
      const s = img[i + w];
      const wv = img[i - 1];
      const ne = img[i - w + 1];
      const se = img[i + w + 1];
      const sw = img[i + w - 1];
      const nw = img[i - w - 1];
      if (
        (n && e && !s && !wv && !sw) ||
        (e && s && !n && !wv && !nw) ||
        (s && wv && !n && !e && !ne) ||
        (wv && n && !s && !e && !se)
      ) {
        img[i] = 0;
      }
    }
  }

  const out = new Uint8Array(m.w * m.h);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) out[y * m.w + x] = img[(y + 1) * w + x + 1];
  }
  return { w: m.w, h: m.h, data: out };
}
