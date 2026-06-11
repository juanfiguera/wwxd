'use client';

import { useEffect } from 'react';
import { tintHex } from '@/lib/persona-styling';

const DEFAULT_ACCENT = '#2e6bf6';
const DEFAULT_ACCENT_SOFT = '#e7eefe';

/**
 * Writes --accent / --accent-soft to documentElement so the active persona's
 * color cascades to everything in the document — including portals, fixed
 * elements, and the body background. Resets on unmount so leaving a chat
 * doesn't leave a stale tint behind.
 */
export function AccentTheme({ color }: { color: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const prevAccent = root.style.getPropertyValue('--accent');
    const prevSoft = root.style.getPropertyValue('--accent-soft');
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-soft', tintHex(color, 0.14));
    return () => {
      if (prevAccent) root.style.setProperty('--accent', prevAccent);
      else root.style.setProperty('--accent', DEFAULT_ACCENT);
      if (prevSoft) root.style.setProperty('--accent-soft', prevSoft);
      else root.style.setProperty('--accent-soft', DEFAULT_ACCENT_SOFT);
    };
  }, [color]);
  return null;
}
