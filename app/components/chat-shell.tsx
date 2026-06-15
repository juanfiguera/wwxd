'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from './brand-mark';

/**
 * Two-pane chat shell: rail on the left, main content on the right.
 *
 * On desktop (≥768px) the rail is always visible and the layout is a fixed
 * 286px grid column. On mobile (<768px) the rail becomes a slide-in drawer
 * triggered by a hamburger in a thin top bar; tapping the backdrop, hitting
 * Escape, or navigating to a new route closes it.
 */
export function ChatShell({
  rail,
  children,
}: {
  rail: React.ReactNode;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on any route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Close drawer on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Lock body scroll while drawer is open so iOS Safari doesn't rubber-band
  // behind the overlay.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh w-screen flex-col bg-[var(--paper)] md:grid md:grid-cols-[286px_minmax(0,1fr)] md:flex-row">
      {/* Mobile-only top bar with hamburger + brand */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--rail)] px-3 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ink)] transition hover:bg-[var(--line-2)]"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <BrandMark size={22} />
        </div>
        {/* Spacer to keep brand centered */}
        <span className="h-9 w-9" />
      </div>

      {/* Rail. Drawer on mobile, fixed column on desktop. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[286px] transform overflow-hidden border-r border-[var(--line)] bg-[var(--rail)] shadow-2xl transition-transform duration-200 ease-out md:relative md:z-0 md:translate-x-0 md:shadow-none ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        aria-hidden={!drawerOpen ? 'true' : undefined}
      >
        {rail}
      </aside>

      {/* Backdrop, mobile only */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
