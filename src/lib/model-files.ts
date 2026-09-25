/** Modely hostované spolu s aplikací (viz scripts/fetch-models.mjs). */
export const MODEL_FILES = {
  lineart: { path: 'models/lineart.onnx', bytes: 17_193_338, rev: '1fef40b8' },
  samEncoder: { path: 'models/sam-encoder.onnx', bytes: 8_882_165, rev: 'cce23c7b' },
  samDecoder: { path: 'models/sam-decoder.onnx', bytes: 4_903_810, rev: 'cb90b279' },
  faceDetect: { path: 'models/face-detect.onnx', bytes: 232_589, rev: '8f2383e4' },
  faceMesh: { path: 'models/face-mesh.onnx', bytes: 4_920_995, rev: 'f38c3321' },
} as const;

export type ModelKey = keyof typeof MODEL_FILES;

/** Klíče ukazatele stahování: modely + běhové prostředí ONNX Runtime. */
export type DownloadKey = ModelKey | 'runtime';

export const MODEL_CACHE = 'omalovankarna-models-v1';

export function modelUrl(key: ModelKey, base: string): string {
  const f = MODEL_FILES[key];
  return new URL(`${f.path}?v=${f.rev}`, base).href;
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 1, minimumFractionDigits: 0 })} MB`;
}
