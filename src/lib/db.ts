import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Level } from '../engine/presets';
import type { SamPoint } from '../engine/models';
import type { Drawing } from '../engine/types';

export interface PageRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  level: Level;
  detail: number;
  /** Styl čar (starší záznamy nemají = tuš). */
  style?: 'pen' | 'ink';
  /** Body výběru hlavní postavy (null = celá fotka). */
  selection: SamPoint[] | null;
  drawing: Drawing;
  /** Zmenšená původní fotka – pro pozdější úpravy. */
  photo: Blob;
  /** Náhled do galerie (čáry, případně s vybarvením). */
  thumb: Blob;
  /** Vybarvená vrstva pod čarami (PNG ve velikosti plátna), pokud existuje. */
  colored: Blob | null;
}

interface Schema extends DBSchema {
  pages: { key: string; value: PageRecord; indexes: { updatedAt: number } };
}

let dbP: Promise<IDBPDatabase<Schema>> | null = null;

/** Ukládání běžící na pozadí – čtení na něj počká, aby nevrátilo starou verzi. */
let pending: Promise<unknown> = Promise.resolve();

export function trackSave<T>(p: Promise<T>): Promise<T> {
  pending = pending.then(() => p).catch(() => {});
  return p;
}

function db() {
  return (dbP ??= openDB<Schema>('omalovankarna', 1, {
    upgrade(d) {
      const store = d.createObjectStore('pages', { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    },
  }));
}

export async function listPages(): Promise<PageRecord[]> {
  await pending;
  const all = await (await db()).getAllFromIndex('pages', 'updatedAt');
  return all.reverse();
}

export async function getPage(id: string): Promise<PageRecord | undefined> {
  await pending;
  return (await db()).get('pages', id);
}

export async function putPage(p: PageRecord): Promise<void> {
  await (await db()).put('pages', p);
  // Požádáme prohlížeč, ať galerii nemaže při nedostatku místa.
  void navigator.storage?.persist?.().catch(() => {});
}

export async function deletePage(id: string): Promise<void> {
  await (await db()).delete('pages', id);
}

export async function clearPages(): Promise<void> {
  await (await db()).clear('pages');
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
