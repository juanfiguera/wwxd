/**
 * Minimal module-level toast emitter. Any module can call `toast.error(msg)`
 * without going through React context — the <ToastTray /> mounted at the
 * root layout subscribes and renders. Keeping it module-level means
 * non-React callers (event handlers, async fetch chains) don't need to
 * thread a hook through.
 */

export type ToastKind = 'error' | 'success' | 'info';

export type ToastItem = {
  id: string;
  kind: ToastKind;
  text: string;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_TTL_MS = 4500;

function notify() {
  for (const l of listeners) l(items);
}

function dismiss(id: string) {
  items = items.filter((t) => t.id !== id);
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  notify();
}

function push(kind: ToastKind, text: string, ttlMs = DEFAULT_TTL_MS) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  items = [...items, { id, kind, text }];
  const timer = setTimeout(() => dismiss(id), ttlMs);
  timers.set(id, timer);
  notify();
  return id;
}

export const toast = {
  error: (text: string, ttlMs?: number) => push('error', text, ttlMs),
  success: (text: string, ttlMs?: number) => push('success', text, ttlMs),
  info: (text: string, ttlMs?: number) => push('info', text, ttlMs),
  dismiss,
};

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
