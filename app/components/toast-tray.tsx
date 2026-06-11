'use client';

import { useEffect, useState } from 'react';
import { subscribeToasts, toast, type ToastItem } from './toast';

export function ToastTray() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-3"
    >
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => toast.dismiss(t.id)}
          className={`pointer-events-auto max-w-[420px] rounded-full border px-4 py-2 font-display text-[13.5px] font-bold shadow-[var(--shadow)] transition hover:-translate-y-0.5 ${
            t.kind === 'error'
              ? 'border-red-300 bg-red-50 text-red-800'
              : t.kind === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-[var(--line)] bg-white text-[var(--ink)]'
          }`}
        >
          {t.kind === 'error' && <span className="mr-1.5">⚠</span>}
          {t.kind === 'success' && <span className="mr-1.5">✓</span>}
          {t.text}
        </button>
      ))}
    </div>
  );
}
