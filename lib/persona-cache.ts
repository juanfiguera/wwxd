/**
 * Process-local cache for a persona's "expensive bundle":
 * - parsed corpus JSON
 * - the static system prompt
 * - a `id → tweet` lookup
 * - a built BM25 index
 *
 * Two API routes used to keep their own copy of this Map. Centralizing it
 * means a single source of truth, one mtime check, one set of tests, and
 * (later) one place to invalidate when ingestion updates a persona.
 *
 * The cache is keyed by username and invalidated automatically when the
 * corpus file's mtime changes. `invalidate()` is exposed for tests and for
 * future ingestion paths that want to drop a stale entry without touching
 * the file.
 */

import { stat } from 'node:fs/promises';
import { buildBm25, type Bm25Index } from './bm25';
import {
  buildStaticPersona,
  corpusPath,
  loadCorpus,
  type Corpus,
  type Tweet,
} from './persona';

export type CorpusBundle = {
  mtime: number;
  corpus: Corpus;
  staticPrompt: string;
  tweetById: Map<string, Tweet>;
  bm25: Bm25Index;
};

const cache = new Map<string, CorpusBundle>();
const inFlight = new Map<string, Promise<CorpusBundle>>();

export async function getCorpusBundle(username: string): Promise<CorpusBundle> {
  const inflight = inFlight.get(username);
  if (inflight) return inflight;
  const load = loadBundle(username);
  inFlight.set(username, load);
  try {
    return await load;
  } finally {
    inFlight.delete(username);
  }
}

async function loadBundle(username: string): Promise<CorpusBundle> {
  const path = corpusPath(username);
  const { mtimeMs } = await stat(path);
  const cached = cache.get(username);
  if (cached && cached.mtime === mtimeMs) return cached;
  const corpus = await loadCorpus(username);
  const staticPrompt = buildStaticPersona(corpus);
  const tweetById = new Map(corpus.tweets.map((t) => [t.id, t]));
  const bm25 = buildBm25(corpus.tweets.filter((t) => t.text.length > 0));
  const entry: CorpusBundle = { mtime: mtimeMs, corpus, staticPrompt, tweetById, bm25 };
  cache.set(username, entry);
  return entry;
}

export function invalidate(username?: string): void {
  if (username === undefined) {
    cache.clear();
    return;
  }
  cache.delete(username);
}

export function size(): number {
  return cache.size;
}
