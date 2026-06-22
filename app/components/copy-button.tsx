'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from './toast';

/** Clipboard write with a fallback for insecure contexts / older Safari where
 *  navigator.clipboard is unavailable. Mirrors the ShareButton fallback. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

type CopyButtonProps = {
  /** Resolved at click time so callers can build a fresh snapshot lazily. */
  getText: () => string;
  /** Tooltip + accessible label for the idle state. */
  title: string;
  /** Optional visible label rendered next to the icon. */
  label?: string;
  className?: string;
  iconSize?: number;
};

/**
 * Copy-to-clipboard button with a transient check-mark confirmation. Used for
 * both per-message copy and whole-conversation copy.
 */
export function CopyButton({
  getText,
  title,
  label,
  className,
  iconSize = 13,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function onClick(e: React.MouseEvent) {
    // These buttons can live inside links/forms — don't trigger navigation or
    // submit.
    e.preventDefault();
    e.stopPropagation();
    const text = getText();
    if (!text.trim()) return;
    const ok = await writeClipboard(text);
    if (!ok) {
      toast.error("Couldn't copy to clipboard.");
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied' : title}
      aria-label={title}
      className={className}
    >
      {copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
      {label && (
        <span className="font-display font-bold">{copied ? 'Copied' : label}</span>
      )}
    </button>
  );
}

function CopyIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
