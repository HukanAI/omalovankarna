import { ringsPath, strokeGroups } from '../engine/svg';
import type { Drawing } from '../engine/types';

export const INK = '#1d1a17';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Vykreslí čáry omalovánky do plátna na pozici (x, y) v daném měřítku. */
export function paintDrawing(ctx: Ctx, d: Drawing, x: number, y: number, scale: number, color = INK): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.fill(new Path2D(ringsPath(d)), 'evenodd');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const g of strokeGroups(d)) {
    ctx.lineWidth = g.width;
    ctx.stroke(new Path2D(g.d));
  }
  ctx.restore();
}

async function blobToBitmap(b: Blob | null | undefined): Promise<ImageBitmap | null> {
  if (!b) return null;
  try {
    return await createImageBitmap(b);
  } catch {
    return null;
  }
}

/** A4 při 300 dpi. */
export const A4 = { w: 2480, h: 3508, marginMm: 12 };

export interface RenderOptions {
  /** 'a4' = stránka k tisku s okraji, 'fit' = jen obrázek. */
  layout: 'a4' | 'fit';
  longSide?: number;
  colored?: Blob | null;
  background?: string;
}

export function a4Layout(d: Drawing) {
  const landscape = d.w > d.h * 1.08;
  const pw = landscape ? A4.h : A4.w;
  const ph = landscape ? A4.w : A4.h;
  const margin = Math.round((A4.marginMm / 25.4) * 300);
  const s = Math.min((pw - 2 * margin) / d.w, (ph - 2 * margin) / d.h);
  return { pw, ph, s, x: (pw - d.w * s) / 2, y: (ph - d.h * s) / 2, landscape };
}

export async function renderToCanvas(d: Drawing, opts: RenderOptions): Promise<OffscreenCanvas> {
  let pw: number, ph: number, s: number, x: number, y: number;
  if (opts.layout === 'a4') {
    ({ pw, ph, s, x, y } = a4Layout(d));
  } else {
    const long = opts.longSide ?? 2400;
    const pad = Math.round(long * 0.03);
    s = (long - 2 * pad) / Math.max(d.w, d.h);
    pw = Math.round(d.w * s + 2 * pad);
    ph = Math.round(d.h * s + 2 * pad);
    x = pad;
    y = pad;
  }
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = opts.background ?? '#ffffff';
  ctx.fillRect(0, 0, pw, ph);
  const color = await blobToBitmap(opts.colored);
  if (color) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(color, x, y, d.w * s, d.h * s);
    color.close();
  }
  paintDrawing(ctx, d, x, y, s);
  return canvas;
}

export async function renderPng(d: Drawing, opts: RenderOptions): Promise<Blob> {
  return (await renderToCanvas(d, opts)).convertToBlob({ type: 'image/png' });
}

export async function renderThumb(d: Drawing, colored?: Blob | null): Promise<Blob> {
  const canvas = await renderToCanvas(d, { layout: 'fit', longSide: 560, colored, background: '#fffdf8' });
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.86 }).catch(() => canvas.convertToBlob());
}
