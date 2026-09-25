import * as Comlink from 'comlink';
import type { EngineApi } from '../workers/engine.worker';
import { MODEL_FILES, type ModelKey } from './model-files';

let remote: Comlink.Remote<EngineApi> | null = null;

/** Stav stahování modelů pro UI. */
export const downloads = $state<Record<ModelKey, { loaded: number; total: number; active: boolean }>>({
  lineart: { loaded: 0, total: MODEL_FILES.lineart.bytes, active: false },
  samEncoder: { loaded: 0, total: MODEL_FILES.samEncoder.bytes, active: false },
  samDecoder: { loaded: 0, total: MODEL_FILES.samDecoder.bytes, active: false },
});

export function engine(): Comlink.Remote<EngineApi> {
  if (!remote) {
    const worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'omalovankarna-engine',
    });
    remote = Comlink.wrap<EngineApi>(worker);
    void remote.setProgress(
      Comlink.proxy((key: ModelKey, loaded: number, total: number) => {
        downloads[key] = { loaded, total, active: loaded < total };
      }),
    );
  }
  return remote;
}

/** Souhrnný průběh stahování zadaných modelů (0..1), nebo null když se nic nestahuje. */
export function downloadProgress(keys: ModelKey[]): { ratio: number; total: number } | null {
  const active = keys.filter((k) => downloads[k].active);
  if (!active.length) return null;
  const loaded = keys.reduce((a, k) => a + (downloads[k].active ? downloads[k].loaded : downloads[k].total), 0);
  const total = keys.reduce((a, k) => a + downloads[k].total, 0);
  return { ratio: loaded / total, total };
}
