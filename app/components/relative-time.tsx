'use client';

import { useSyncExternalStore } from 'react';

function formatRelative(iso: string, now: number): string {
  if (!iso) return '';
  const date = new Date(iso).getTime();
  const ms = now - date;
  const sec = Math.round(ms / 1000);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (sec < 60) return fmt.format(-sec, 'second');
  const min = Math.round(sec / 60);
  if (min < 60) return fmt.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (hr < 24) return fmt.format(-hr, 'hour');
  const day = Math.round(hr / 24);
  if (day < 7) return fmt.format(-day, 'day');
  const wk = Math.round(day / 7);
  if (wk < 5) return fmt.format(-wk, 'week');
  const mo = Math.round(day / 30);
  if (mo < 12) return fmt.format(-mo, 'month');
  const yr = Math.round(day / 365);
  return fmt.format(-yr, 'year');
}

// Shared "now" cache. `useSyncExternalStore` calls `getSnapshot` multiple
// times per render to detect tearing; if we returned a fresh `Date.now()`
// each call, the values would always differ and React would warn about an
// infinite loop. Update the cache only when the interval tick fires.
let cachedNow = 0;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (listeners.size === 1) {
    cachedNow = Date.now();
    intervalId = setInterval(() => {
      cachedNow = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  // First read after mount (before subscribe runs) — populate lazily.
  if (cachedNow === 0) cachedNow = Date.now();
  return cachedNow;
}

function getServerSnapshot(): number {
  return 0;
}

export function RelativeTime({ iso }: { iso: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!iso) return null;
  const text = now === 0 ? '' : formatRelative(iso, now);
  return (
    <span title={new Date(iso).toLocaleString()} suppressHydrationWarning>
      {text || '...'}
    </span>
  );
}
