import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { corpusPath, type Corpus } from '../persona';
import type { Tweet } from './types';

/**
 * Shared corpus I/O for every ingester. Lets impls focus on "where do
 * tweets come from?" without each one re-implementing the merge-and-save
 * dance against the existing on-disk corpus.
 */

export const RawTweet = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
    text: z.string().optional(),
    fullText: z.string().optional(),
    createdAt: z.string().optional(),
    likeCount: z.number().optional(),
    retweetCount: z.number().optional(),
    replyCount: z.number().optional(),
    viewCount: z.number().optional(),
    isReply: z.boolean().optional(),
    isRetweet: z.boolean().optional(),
    isQuote: z.boolean().optional(),
    likes: z.number().optional(),
    retweets: z.number().optional(),
    replies: z.number().optional(),
    views: z.number().optional(),
    author: z
      .object({ userName: z.string().optional(), name: z.string().optional() })
      .partial()
      .optional(),
  })
  .passthrough();

export type RawTweet = z.infer<typeof RawTweet>;

export function normalizeRawTweet(raw: RawTweet): Tweet | null {
  const text = raw.fullText ?? raw.text ?? '';
  const id = raw.id ?? '';
  if (!text || !id) return null;
  return {
    id,
    url: raw.url ?? `https://x.com/i/web/status/${id}`,
    text,
    createdAt: raw.createdAt ?? '',
    likes: raw.likeCount ?? raw.likes ?? 0,
    retweets: raw.retweetCount ?? raw.retweets ?? 0,
    replies: raw.replyCount ?? raw.replies ?? 0,
    views: raw.viewCount ?? raw.views ?? 0,
    isReply: raw.isReply ?? false,
    isRetweet: raw.isRetweet ?? false,
    isQuote: raw.isQuote ?? false,
  };
}

export async function loadExistingCorpus(path: string): Promise<Corpus | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { username: '', displayName: '', fetchedAt: '', tweets: parsed as Tweet[] };
    }
    return parsed as Corpus;
  } catch {
    return null;
  }
}

export async function saveCorpus(
  path: string,
  username: string,
  displayName: string,
  byId: Map<string, Tweet>,
): Promise<{ total: number; originals: number }> {
  const merged = Array.from(byId.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  const corpus: Corpus = {
    username,
    displayName: displayName || username,
    fetchedAt: new Date().toISOString(),
    tweets: merged,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(corpus, null, 2), 'utf8');
  return {
    total: merged.length,
    originals: merged.filter((t) => !t.isReply && !t.isRetweet).length,
  };
}

export { corpusPath };

/**
 * Common load-existing-corpus pattern, factored out so essay/youtube/tweet
 * ingesters all read the same on-disk format identically.
 */
export async function startCorpusMerge(username: string): Promise<{
  outPath: string;
  byId: Map<string, Tweet>;
  initialDisplayName: string;
}> {
  const outPath = corpusPath(username);
  const existing = await loadExistingCorpus(outPath);
  const byId = new Map<string, Tweet>();
  for (const t of existing?.tweets ?? []) byId.set(t.id, t);
  return {
    outPath,
    byId,
    initialDisplayName: existing?.displayName || username,
  };
}
