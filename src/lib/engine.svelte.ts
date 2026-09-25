import * as Comlink from 'comlink';
import type { EngineApi } from '../workers/engine.worker';
import { MODEL_FILES, type DownloadKey } from './model-files';

let remote: Comlink.Remote<EngineApi> | null = null;

/** Stav stahování modelů pro UI. */
interface Download {
  loaded: number;
  total: number;
  active: boolean;
  /** Stahovalo se v tomto spuštění (co je už v cache, se do průběhu nepočítá). */
  seen: boolean;
}

export const downloads = $state<Record<DownloadKey, Download>>({
  runtime: { loaded: 0, total: 0, active: false, seen: false },
  lineart: { loaded: 0, total: MODEL_FILES.lineart.bytes, active: false, seen: false },
  samEncoder: { loaded: 0, total: MODEL_FILES.samEncoder.bytes, active: false, seen: false },
  samDecoder: { loaded: 0, total: MODEL_FILES.samDecoder.bytes, active: false, seen: false },
});

export function engine(): Comlink.Remote<EngineApi> {
  if (!remote) {
    const worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'omalovankarna-engine',
    });
    remote = Comlink.wrap<EngineApi>(worker);
    void remote.setProgress(
      Comlink.proxy((key: DownloadKey, loaded: number, total: number) => {
        downloads[key] = { loaded, total, active: loaded < total, seen: true };
      }),
    );
  }
  return remote;
}

/** Souhrnný průběh stahování zadaných modelů (0..1), nebo null když se nic nestahuje. */
export function downloadProgress(keys: DownloadKey[]): { ratio: number; total: number } | null {
  const seen = keys.filter((k) => downloads[k].seen);
  if (!seen.some((k) => downloads[k].active)) return null;
  const loaded = seen.reduce((a, k) => a + downloads[k].loaded, 0);
  const total = seen.reduce((a, k) => a + downloads[k].total, 0);
  return { ratio: total ? loaded / total : 0, total };
}
