import { MODEL_CACHE, MODEL_FILES, modelUrl, type ModelKey } from '../lib/model-files';

export type ProgressFn = (key: ModelKey, loaded: number, total: number) => void;

const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(MODEL_CACHE);
  } catch {
    return null; // např. anonymní režim bez Cache API
  }
}

export async function isCached(key: ModelKey): Promise<boolean> {
  const cache = await openCache();
  return !!(cache && (await cache.match(modelUrl(key, base))));
}

/**
 * Stáhne model s průběhem a uloží ho do Cache API, takže příště
 * (i bez internetu) se načte okamžitě.
 */
export async function loadModel(key: ModelKey, onProgress?: ProgressFn): Promise<Uint8Array> {
  const url = modelUrl(key, base);
  const cache = await openCache();
  const hit = cache && (await cache.match(url));
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Model ${key} se nepodařilo stáhnout (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || MODEL_FILES[key].bytes;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(key, Math.min(loaded, total), total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  // GitHub Pages posílá modely gzipované – content-length pak nesedí,
  // proto kontrolujeme skutečnou velikost proti známé.
  if (buf.length !== MODEL_FILES[key].bytes) throw new Error(`Model ${key} se nestáhl celý.`);
  onProgress?.(key, total, total);
  try {
    await cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    // Plné úložiště – model poběží, jen se příště stáhne znovu.
  }
  return buf;
}
