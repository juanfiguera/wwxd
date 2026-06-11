'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildSnapshot,
  snapshotToJsonBlob,
  snapshotToMarkdown,
  snapshotToPlainText,
  suggestedFilename,
  type ShareMessage,
  type SharePersona,
} from '@/lib/share';

type Action = 'markdown' | 'plain' | 'json';

type ShareButtonProps = {
  kind: 'solo' | 'roundtable';
  title?: string;
  personas: SharePersona[];
  messages: ShareMessage[];
  disabled?: boolean;
  /** Optional accent color for the open-state highlight. */
  accentColor?: string;
};

const MENU_WIDTH = 220;
const MENU_GAP = 6;

export function ShareButton({
  kind,
  title,
  personas,
  messages,
  disabled,
  accentColor,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<Action | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the fixed-positioned menu under the trigger, clamped to the
  // viewport so it never hangs off the right edge.
  function recomputePosition() {
    const trigger = buttonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - MENU_WIDTH - 8,
      Math.max(8, rect.right - MENU_WIDTH),
    );
    const top = rect.bottom + MENU_GAP;
    setMenuPos({ top, left });
  }

  // Reposition when opened, and keep it pinned to the trigger as the user
  // scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    recomputePosition();
    window.addEventListener('scroll', recomputePosition, true);
    window.addEventListener('resize', recomputePosition);
    return () => {
      window.removeEventListener('scroll', recomputePosition, true);
      window.removeEventListener('resize', recomputePosition);
    };
  }, [open]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        buttonRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset confirmation after 1.6s.
  useEffect(() => {
    if (!confirmed) return;
    const id = setTimeout(() => setConfirmed(null), 1600);
    return () => clearTimeout(id);
  }, [confirmed]);

  function buildSnapshotNow() {
    return buildSnapshot({
      kind,
      title,
      personas,
      messages: messages.filter((m) => m.text.trim().length > 0),
    });
  }

  async function copyAs(action: 'markdown' | 'plain') {
    const snap = buildSnapshotNow();
    const text =
      action === 'markdown' ? snapshotToMarkdown(snap) : snapshotToPlainText(snap);
    try {
      await navigator.clipboard.writeText(text);
      setConfirmed(action);
    } catch {
      // Clipboard API unavailable (older Safari, insecure context). Fall back to
      // a hidden textarea + document.execCommand.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setConfirmed(action);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  function downloadJson() {
    const snap = buildSnapshotNow();
    const blob = snapshotToJsonBlob(snap);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFilename(snap);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 250);
    setConfirmed('json');
  }

  const noMessages = messages.filter((m) => m.text.trim().length > 0).length === 0;
  const isDisabled = disabled || noMessages;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isDisabled}
        aria-label="Share conversation"
        title={isDisabled ? 'Nothing to share yet' : 'Share conversation'}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-display text-xs font-bold transition disabled:opacity-40 ${
          open
            ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
            : 'border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--ink)]'
        }`}
        style={open && accentColor ? { background: accentColor, borderColor: accentColor } : undefined}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <path d="M16 6l-4-4-4 4" />
          <path d="M12 2v14" />
        </svg>
        share
      </button>
      {open &&
        menuPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              width: MENU_WIDTH,
              zIndex: 50,
            }}
            className="rounded-[var(--r)] border border-[var(--line)] bg-white p-1 shadow-[var(--shadow)]"
          >
            <ShareMenuItem
              onClick={() => copyAs('markdown')}
              confirmed={confirmed === 'markdown'}
              label="Copy as Markdown"
              hint="Slack, Discord, GitHub"
            />
            <ShareMenuItem
              onClick={() => copyAs('plain')}
              confirmed={confirmed === 'plain'}
              label="Copy as plain text"
              hint="iMessage, email"
            />
            <ShareMenuItem
              onClick={downloadJson}
              confirmed={confirmed === 'json'}
              label="Download .wwxd.json"
              hint="Re-import later"
            />
            <p className="mt-1 px-2 pb-1 pt-2 text-[10.5px] leading-snug text-[var(--ink-faint)]">
              Snapshots are AI-generated impressions, not the real person&apos;s
              words.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

function ShareMenuItem({
  onClick,
  confirmed,
  label,
  hint,
}: {
  onClick: () => void;
  confirmed: boolean;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-left transition hover:bg-[var(--line-2)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[12.5px] font-bold text-[var(--ink)]">
          {confirmed ? 'Copied!' : label}
        </span>
        <span className="block text-[10.5px] text-[var(--ink-soft)]">{hint}</span>
      </span>
      {confirmed && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0 text-[var(--ink)]"
          aria-hidden
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </button>
  );
}
