'use client';

import { useSyncExternalStore } from 'react';
import type { PullJobStatus } from './use-pull-job';

const EARLIEST_YEAR = 2010;

// Shared "now" cache. `useSyncExternalStore` calls `getSnapshot` multiple
// times per render to detect tearing; returning a fresh `Date.now()` each
// call makes React think the store keeps changing → infinite-loop warning.
// Update the cache only when the interval tick fires.
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
    }, 1000);
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
  if (cachedNow === 0) cachedNow = Date.now();
  return cachedNow;
}

function getServerSnapshot(): number {
  return 0;
}

function useNow(active: boolean): number {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return active ? value : 0;
}

function fmtMonthYear(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function timelineProgress(currentWindowStart?: string): number {
  if (!currentWindowStart) return 0;
  const now = Date.now();
  const earliest = new Date(`${EARLIEST_YEAR}-01-01`).getTime();
  const current = new Date(currentWindowStart).getTime();
  return Math.min(1, Math.max(0, (now - current) / (now - earliest)));
}

type StatusColor = 'emerald' | 'red' | 'zinc';

function dotColor(state: PullJobStatus['state']): StatusColor {
  if (state === 'error') return 'red';
  if (state === 'done') return 'emerald';
  return 'emerald';
}

const colorClasses: Record<StatusColor, { dot: string; bar: string }> = {
  emerald: { dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  red: { dot: 'bg-red-500', bar: 'bg-red-500' },
  zinc: { dot: 'bg-zinc-400', bar: 'bg-zinc-400' },
};

export function PullProgress({
  status,
  onDismiss,
}: {
  status: PullJobStatus;
  onDismiss?: () => void;
}) {
  const active = status.state === 'running';
  const now = useNow(active);

  if (status.state === 'idle') return null;

  const color = dotColor(status.state);
  const colors = colorClasses[color];

  let headline = '';
  if (status.state === 'running') {
    if (status.stage === 'fetching') {
      if (status.currentWindow) {
        headline = `Fetching tweets ${fmtMonthYear(status.currentWindow.start)} → ${fmtMonthYear(status.currentWindow.end)}`;
      } else {
        headline = 'Fetching latest tweets...';
      }
    } else if (status.stage === 'essays') {
      headline = `Fetching essays (${status.essayCount.toLocaleString()})`;
    } else if (status.stage === 'youtube') {
      headline = `Fetching YouTube transcripts (${status.transcriptCount.toLocaleString()})`;
    } else if (status.stage === 'embedding') {
      headline =
        status.embeddedTotal > 0
          ? `Embedding ${status.embeddedCount.toLocaleString()} of ${status.embeddedTotal.toLocaleString()}`
          : 'Preparing embeddings...';
    } else {
      headline = 'Starting...';
    }
  } else if (status.state === 'done') {
    headline = `Done — @${status.username} is ready`;
  } else if (status.state === 'error') {
    headline = status.message ?? 'Something went wrong';
  }

  const elapsed = status.startedAt && now > 0 ? now - status.startedAt : 0;

  const showTimeline =
    status.deep && status.stage === 'fetching' && Boolean(status.currentWindow);
  const showEmbedBar =
    status.stage === 'embedding' && status.embeddedTotal > 0;

  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
            {active && (
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colors.dot} opacity-75`}
              />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${colors.dot}`}
            />
          </span>
          <span className="truncate font-display text-sm font-bold text-[var(--ink)]">
            {headline}
          </span>
        </div>
        {elapsed > 0 && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--ink-soft)]">
            {fmtElapsed(elapsed)}
          </span>
        )}
      </div>

      {showTimeline && (
        <div className="mt-4">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className={`h-full ${colors.bar} transition-all duration-500 ease-out`}
              style={{ width: `${timelineProgress(status.currentWindow?.start) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
            <span>now</span>
            <span>walking back to {EARLIEST_YEAR}</span>
          </div>
        </div>
      )}

      {showEmbedBar && (
        <div className="mt-4">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className={`h-full ${colors.bar} transition-all duration-300 ease-out`}
              style={{ width: `${(status.embeddedCount / status.embeddedTotal) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-4 gap-3">
        <Stat label="tweets" value={status.totalTweets} active={active && status.stage === 'fetching'} />
        <Stat label="essays" value={status.essayCount} active={active && status.stage === 'essays'} />
        <Stat label="videos" value={status.transcriptCount} active={active && status.stage === 'youtube'} />
        <Stat
          label="embedded"
          value={status.embeddedCount}
          suffix={
            status.embeddedTotal > 0
              ? ` / ${status.embeddedTotal.toLocaleString()}`
              : undefined
          }
          active={active && status.stage === 'embedding'}
        />
      </div>

      {status.lines.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)]">
            <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
            activity log ({status.lines.length})
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-[var(--r)] bg-[var(--paper-2)] p-2 font-mono text-[10px] leading-relaxed text-[var(--ink-2)]">
            {status.lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </details>
      )}

      {(status.state === 'done' || status.state === 'error') && onDismiss && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={onDismiss}
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  active,
}: {
  label: string;
  value: number;
  suffix?: string;
  active?: boolean;
}) {
  return (
    <div>
      <div
        className={`font-display text-lg font-extrabold tabular-nums leading-tight transition-colors ${
          active ? 'text-[var(--ink)]' : 'text-[var(--ink-soft)]'
        }`}
      >
        {value.toLocaleString()}
        {suffix}
      </div>
      <div className="font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
      </div>
    </div>
  );
}
