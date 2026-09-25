import type { Mask, Plane, RGBA } from './types';

/**
 * Separabilní převzorkování s trojúhelníkovým jádrem, jehož šířka roste
 * s poměrem zmenšení (stejný princip jako Pillow). Při zmenšování tak
 * průměruje všechny zdrojové pixely a nevznikají moaré ani „schody“.
 */
function resampleAxis(
  src: Float32Array,
  sw: number,
  sh: number,
  ch: number,
  dstLen: number,
  horizontal: boolean,
): Float32Array {
  const srcLen = horizontal ? sw : sh;
  const other = horizontal ? sh : sw;
  const scale = srcLen / dstLen;
  const support = Math.max(1, scale);
  const out = new Float32Array((horizontal ? dstLen * sh : sw * dstLen) * ch);

  const lo = new Int32Array(dstLen);
  const counts = new Int32Array(dstLen);
  const maxTaps = Math.ceil(support) * 2 + 2;
  const weights = new Float32Array(dstLen * maxTaps);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * scale;
    const a = Math.max(0, Math.floor(center - support));
    const b = Math.min(srcLen, Math.ceil(center + support));
    let sum = 0;
    let n = 0;
    for (let j = a; j < b && n < maxTaps; j++, n++) {
      const wgt = Math.max(0, 1 - Math.abs((j + 0.5 - center) / support));
      weights[i * maxTaps + n] = wgt;
      sum += wgt;
    }
    lo[i] = a;
    counts[i] = n;
    if (sum > 0) for (let k = 0; k < n; k++) weights[i * maxTaps + k] /= sum;
  }

  for (let o = 0; o < other; o++) {
    for (let i = 0; i < dstLen; i++) {
      const base = i * maxTaps;
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let k = 0; k < counts[i]; k++) {
          const j = lo[i] + k;
          const si = horizontal ? (o * sw + j) * ch + c : (j * sw + o) * ch + c;
          acc += src[si] * weights[base + k];
        }
        const di = horizontal ? (o * dstLen + i) * ch + c : (i * sw + o) * ch + c;
        out[di] = acc;
      }
    }
  }
  return out;
}

export function resampleFloat(
  src: Float32Array,
  sw: number,
  sh: number,
  ch: number,
  dw: number,
  dh: number,
): Float32Array {
  let data = src;
  let w = sw;
  if (dw !== sw) {
    data = resampleAxis(data, sw, sh, ch, dw, true);
    w = dw;
  }
  if (dh !== sh) data = resampleAxis(data, w, sh, ch, dh, false);
  return data === src ? src.slice() : data;
}

export function resizePlane(p: Plane, w: number, h: number): Plane {
  if (p.w === w && p.h === h) return { w, h, data: p.data.slice() };
  return { w, h, data: resampleFloat(p.data, p.w, p.h, 1, w, h) };
}

export function resizeRGBA(img: RGBA, w: number, h: number): RGBA {
  const f = new Float32Array(img.data.length);
  for (let i = 0; i < f.length; i++) f[i] = img.data[i];
  const r = resampleFloat(f, img.w, img.h, 4, w, h);
  return { w, h, data: Uint8ClampedArray.from(r) };
}

/** Rozměry, které se vejdou do `longSide` a jsou dělitelné `multiple`. */
export function fitSize(w: number, h: number, longSide: number, multiple = 1) {
  const s = longSide / Math.max(w, h);
  const round = (v: number) => Math.max(multiple, Math.round((v * s) / multiple) * multiple);
  return { w: round(w), h: round(h) };
}

/** RGBA → planární RGB 0..1 (NCHW bez dávky). */
export function toCHW(img: RGBA, mean?: number[], std?: number[]): Float32Array {
  const n = img.w * img.h;
  const out = new Float32Array(3 * n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      let v = d[i * 4 + c] / 255;
      if (mean && std) v = (v - mean[c]) / std[c];
      out[c * n + i] = v;
    }
  }
  return out;
}

export function luminance(img: RGBA): Plane {
  const n = img.w * img.h;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  }
  return { w: img.w, h: img.h, data: out };
}

function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

export function blur(p: Plane, sigma: number): Plane {
  if (sigma <= 0) return { w: p.w, h: p.h, data: p.data.slice() };
  const { w, h } = p;
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        acc += p.data[row + xx] * k[i + r];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        acc += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = acc;
    }
  }
  return { w, h, data: out };
}

/**
 * Přesná euklidovská vzdálenostní transformace (Felzenszwalb & Huttenlocher).
 * Vrací vzdálenost každého pixelu k nejbližšímu pixelu masky.
 */
export function distanceTransform(m: Mask): Float32Array {
  const { w, h } = m;
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = m.data[i] ? 0 : INF;

  const edt1d = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return { w: m.w, h: m.h, data: m.data.slice() };
  const dt = distanceTransform(m);
  const out = new Uint8Array(m.w * m.h);
  for (let i = 0; i < out.length; i++) out[i] = dt[i] <= r ? 1 : 0;
  return { w: m.w, h: m.h, data: out };
}

export function invert(m: Mask): Mask {
  const out = new Uint8Array(m.data.length);
  for (let i = 0; i < out.length; i++) out[i] = m.data[i] ? 0 : 1;
  return { w: m.w, h: m.h, data: out };
}

export function erode(m: Mask, r: number): Mask {
  return invert(dilate(invert(m), r));
}

/** Morfologické uzavření: spojí mezery užší než ~2r. */
export function close(m: Mask, r: number): Mask {
  return erode(dilate(m, r), r);
}

/** Box filtr pomocí integrálního obrazu (O(1) na pixel bez ohledu na poloměr). */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/**
 * Hranově zachovávající vyhlazení (guided filter, He et al. 2010) vedené jasem.
 * Smaže jemné textury (srst, tráva, zrno), ale ponechá obrysy – kreslicí síť
 * pak nakreslí jen to podstatné.
 */
export function abstractImage(img: RGBA, radius: number, eps: number, iterations = 1): RGBA {
  const { w, h } = img;
  const n = w * h;
  let cur = img;
  for (let it = 0; it < iterations; it++) {
    const I = luminance(cur).data;
    const meanI = boxMean(I, w, h, radius);
    const II = new Float32Array(n);
    for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
    const varI = boxMean(II, w, h, radius);
    for (let i = 0; i < n; i++) varI[i] -= meanI[i] * meanI[i];
    const out = new Uint8ClampedArray(cur.data.length);
    for (let c = 0; c < 3; c++) {
      const p = new Float32Array(n);
      const Ip = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        p[i] = cur.data[i * 4 + c] / 255;
        Ip[i] = I[i] * p[i];
      }
      const meanP = boxMean(p, w, h, radius);
      const meanIp = boxMean(Ip, w, h, radius);
      const a = new Float32Array(n);
      const b = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        a[i] = (meanIp[i] - meanI[i] * meanP[i]) / (varI[i] + eps);
        b[i] = meanP[i] - a[i] * meanI[i];
      }
      const ma = boxMean(a, w, h, radius);
      const mb = boxMean(b, w, h, radius);
      for (let i = 0; i < n; i++) out[i * 4 + c] = (ma[i] * I[i] + mb[i]) * 255;
    }
    for (let i = 0; i < n; i++) out[i * 4 + 3] = cur.data[i * 4 + 3];
    cur = { w, h, data: out };
  }
  return cur;
}

/** Hodnota daného kvantilu (0..1) – na odhad kontrastu mapy čar. */
export function quantile(p: Plane, q: number): number {
  const hist = new Uint32Array(1024);
  for (let i = 0; i < p.data.length; i++) hist[Math.min(1023, Math.max(0, (p.data[i] * 1023) | 0))]++;
  const target = q * p.data.length;
  let acc = 0;
  for (let i = 0; i < 1024; i++) {
    acc += hist[i];
    if (acc >= target) return i / 1023;
  }
  return 1;
}
