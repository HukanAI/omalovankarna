/** Fotka ze souboru jako bitmapa se správnou orientací podle EXIF. */
export async function fileToBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Starší Safari: dekódování přes <img> (orientaci aplikuje prohlížeč sám).
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Zmenšená kopie pro galerii (JPEG). */
export async function bitmapToBlob(bmp: ImageBitmap, maxSide: number, quality = 0.85): Promise<Blob> {
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s);
  const h = Math.round(bmp.height * s);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
