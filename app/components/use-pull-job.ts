'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { describe, readNdjson, type ProgressEvent } from './persona-stream';

export type PullJobOptions = {
  mode?: 'latest' | 'deep' | 'skip' | 'prior-only';
  essayRss?: string;
  essaySitemap?: string;
  essayUrls?: string[];
  youtubeUrls?: string[];
  // Prior-only personas: displayName is required, bio is optional context
  // from the disambiguation step. Ignored for grounded modes.
  displayName?: string;
  bio?: string;
};

export type PullJobStatus = {
  state: 'idle' | 'running' | 'done' | 'error';
  stage?: 'fetching' | 'essays' | 'youtube' | 'embedding';
  deep: boolean;
  username?: string;
  currentWindow?: { start: string; end: string };
  totalTweets: number;
  originals: number;
  essayCount: number;
  transcriptCount: number;
  embeddedCount: number;
  embeddedTotal: number;
  startedAt?: number;
  lines: string[];
  message?: string;
};

const INITIAL: PullJobStatus = {
  state: 'idle',
  deep: false,
  totalTweets: 0,
  originals: 0,
  essayCount: 0,
  transcriptCount: 0,
  embeddedCount: 0,
  embeddedTotal: 0,
  lines: [],
};

function applyEvent(s: PullJobStatus, evt: ProgressEvent): PullJobStatus {
  const line = describe(evt);
  const lines = line ? [...s.lines, line] : s.lines;

  switch (evt.stage) {
    case 'fetch-start':
      return { ...s, stage: 'fetching', lines };
    case 'fetch':
      if (evt.type === 'window' && evt.start && evt.end) {
        return { ...s, currentWindow: { start: evt.start, end: evt.end }, lines };
      }
      if (
        evt.type === 'window-done' &&
        typeof evt.total === 'number' &&
        typeof evt.originals === 'number'
      ) {
        return { ...s, totalTweets: evt.total, originals: evt.originals, lines };
      }
      if (
        evt.type === 'saved' &&
        typeof evt.total === 'number' &&
        typeof evt.originals === 'number'
      ) {
        return { ...s, totalTweets: evt.total, originals: evt.originals, lines };
      }
      return { ...s, lines };
    case 'essays-start':
      return { ...s, stage: 'essays', currentWindow: undefined, lines };
    case 'essays':
      if (evt.type === 'fetched') {
        return { ...s, essayCount: s.essayCount + 1, lines };
      }
      return { ...s, lines };
    case 'youtube-start':
      return { ...s, stage: 'youtube', currentWindow: undefined, lines };
    case 'youtube':
      if (evt.type === 'fetched') {
        return { ...s, transcriptCount: s.transcriptCount + 1, lines };
      }
      return { ...s, lines };
    case 'embed-start':
      return { ...s, stage: 'embedding', currentWindow: undefined, lines };
    case 'embed':
      if (evt.type === 'start' && typeof evt.total === 'number') {
        return { ...s, embeddedTotal: evt.total, lines };
      }
      if (
        evt.type === 'batch' &&
        typeof evt.done === 'number' &&
        typeof evt.total === 'number'
      ) {
        return { ...s, embeddedCount: evt.done, embeddedTotal: evt.total, lines };
      }
      if (evt.type === 'saved' && typeof evt.total === 'number') {
        return { ...s, embeddedCount: evt.total, embeddedTotal: evt.total, lines };
      }
      return { ...s, lines };
    default:
      return { ...s, lines };
  }
}

export function usePullJob() {
  const router = useRouter();
  const [status, setStatus] = useState<PullJobStatus>(INITIAL);

  async function start(username: string, opts: PullJobOptions = {}): Promise<void> {
    const mode = opts.mode ?? 'latest';
    const init: PullJobStatus = {
      ...INITIAL,
      state: 'running',
      deep: mode === 'deep',
      username,
      startedAt: Date.now(),
    };
    setStatus(init);

    try {
      const body: Record<string, unknown> = { username, mode };
      if (opts.essayRss) body.essayRss = opts.essayRss;
      if (opts.essaySitemap) body.essaySitemap = opts.essaySitemap;
      if (opts.essayUrls && opts.essayUrls.length > 0) body.essayUrls = opts.essayUrls;
      if (opts.youtubeUrls && opts.youtubeUrls.length > 0) body.youtubeUrls = opts.youtubeUrls;
      if (opts.displayName) body.displayName = opts.displayName;
      if (opts.bio) body.bio = opts.bio;

      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        setStatus({ ...init, state: 'error', message: errBody.error ?? 'Request failed' });
        return;
      }

      let current = init;
      let sawError: string | null = null;
      for await (const event of readNdjson(res)) {
        current = applyEvent(current, event);
        setStatus({ ...current });
        if (event.stage === 'error') sawError = event.message ?? 'Unknown error';
      }

      if (sawError) {
        setStatus({ ...current, state: 'error', message: sawError });
        return;
      }

      setStatus({ ...current, state: 'done' });
      router.refresh();
    } catch (err) {
      setStatus({
        ...INITIAL,
        state: 'error',
        deep: mode === 'deep',
        username,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset(): void {
    setStatus(INITIAL);
  }

  return { status, start, reset };
}
