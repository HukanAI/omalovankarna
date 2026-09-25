import { isIOS } from './device.svelte';

export type ShareResult = 'shared' | 'saved' | 'cancelled';

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Uloží soubor do telefonu. Na iPhonu vede cesta do Fotek přes sdílecí list
 * („Uložit obrázek“), jinde se soubor rovnou stáhne.
 */
export async function saveToDevice(blob: Blob, filename: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type });
  if (isIOS && canShareFile(file)) return share(file);
  download(blob, filename);
  return 'saved';
}

export async function shareFile(blob: Blob, filename: string, title?: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type });
  if (!canShareFile(file)) {
    download(blob, filename);
    return 'saved';
  }
  return share(file, title);
}

async function share(file: File, title?: string): Promise<ShareResult> {
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return 'cancelled';
    download(file, file.name);
    return 'saved';
  }
}

export function fileName(ext: string, date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `omalovanka-${d}-${date.getHours()}${String(date.getMinutes()).padStart(2, '0')}.${ext}`;
}
