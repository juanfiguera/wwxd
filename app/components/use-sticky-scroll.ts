'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_THRESHOLD = 80;

/**
 * Auto-scrolls a container to the bottom on every render — but ONLY if the
 * user is currently near the bottom. Once they scroll up to read, we stop
 * forcing them back. When they scroll back near the bottom, sticky behavior
 * re-engages automatically.
 *
 * Returns:
 *  - `ref` to attach to the scroll container
 *  - `pinned` — whether we're currently auto-scrolling (false when the user has scrolled up)
 *  - `scrollToBottom` — manually jump back to the bottom (re-engages pinning)
 *
 * Call `ping()` whenever new content arrives (e.g., in the same useEffect that
 * tracks messages). The hook will scroll if pinned, otherwise no-op.
 */
export function useStickyScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  // Track scroll position to detect when user scrolls away from the bottom.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < NEAR_BOTTOM_THRESHOLD;
      if (atBottom !== pinnedRef.current) {
        pinnedRef.current = atBottom;
        setPinned(atBottom);
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  // Call this whenever the content updates (e.g., new message chunk).
  // Scrolls if pinned, no-op if user is reading above.
  const ping = useCallback(() => {
    if (!pinnedRef.current) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  return { ref, pinned, scrollToBottom, ping };
}
