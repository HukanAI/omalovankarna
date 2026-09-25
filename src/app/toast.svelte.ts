export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: 'info' | 'error';
}

let nextId = 1;

export const toasts = $state<Toast[]>([]);

export function toast(text: string, opts: Omit<Toast, 'id' | 'text'> & { ms?: number } = {}): void {
  const id = nextId++;
  toasts.push({ id, text, action: opts.action, tone: opts.tone });
  const ms = opts.ms ?? (opts.action ? 6000 : 3200);
  setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
