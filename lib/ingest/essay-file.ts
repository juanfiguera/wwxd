import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { saveCorpus, startCorpusMerge } from './corpus-io';
import type {
  EssayIngester,
  EssayProgress,
  EssayResult,
  Tweet,
} from './types';

/**
 * Loads essays from a JSON file you bring yourself. Useful when you've
 * already extracted essays through some other path (a personal Pocket
 * export, a manual scrape, an Obsidian vault dump) and don't want wwxd to
 * touch the network.
 *
 * Accepted shapes:
 *   - Bare array:  `[ { url, title, text, createdAt? }, ... ]`
 *   - Manifest:    `{ displayName?, essays: [ ... ] }`
 *
 * Path resolution: the first CLI arg if it ends in .json → ESSAY_FILE_PATH
 * env → data/<username>.essays.import.json.
 */

const Essay = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  text: z.string().min(1),
  createdAt: z.string().optional(),
});
type Essay = z.infer<typeof Essay>;

const Manifest = z.union([
  z.array(Essay),
  z.object({
    displayName: z.string().optional(),
    essays: z.array(Essay),
  }),
]);

function essayId(item: Essay): string {
  const seed = item.url ?? `${item.title ?? ''}\n${item.text.slice(0, 200)}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export const essayFileIngester: EssayIngester = async function essayFileIngester(
  username: string,
  urls: string[],
  onProgress: (event: EssayProgress) => void,
): Promise<EssayResult> {
  const inputPath = resolveInputPath(username, urls);
  const raw = await readFile(inputPath, 'utf8').catch((err) => {
    throw new Error(
      `Essay file ingester: could not read ${inputPath}. ` +
        `Pass the path as the first arg (must end in .json), ` +
        `set ESSAY_FILE_PATH, or drop a file at data/${username}.essays.import.json. ` +
        `(${err instanceof Error ? err.message : err})`,
    );
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Essay file ingester: ${inputPath} is not valid JSON. ` +
        `(${err instanceof Error ? err.message : err})`,
    );
  }
  const manifest = Manifest.safeParse(parsed);
  if (!manifest.success) {
    throw new Error(
      `Essay file ingester: ${inputPath} doesn't match the expected shape ` +
        `([{ url?, title?, text }] or { essays: [...] }). ` +
        `Issue: ${manifest.error.issues[0]?.message}`,
    );
  }
  const items: Essay[] = Array.isArray(manifest.data)
    ? manifest.data
    : manifest.data.essays;
  const manifestDisplayName = Array.isArray(manifest.data)
    ? null
    : manifest.data.displayName ?? null;

  const { outPath, byId, initialDisplayName } = await startCorpusMerge(username);
  const displayName =
    manifestDisplayName && initialDisplayName === username
      ? manifestDisplayName
      : initialDisplayName;

  onProgress({ type: 'start', total: items.length });

  let added = 0;
  for (const item of items) {
    const id = essayId(item);
    if (item.text.length < 50) {
      onProgress({
        type: 'failed',
        url: item.url ?? id,
        message: `text too short (${item.text.length} chars)`,
      });
      continue;
    }
    const tweet: Tweet = {
      id,
      url: item.url ?? '',
      text: item.text,
      title: item.title ?? 'Untitled',
      createdAt: item.createdAt ?? '',
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      isReply: false,
      isRetweet: false,
      isQuote: false,
      source: 'essay',
    };
    if (!byId.has(id)) added += 1;
    byId.set(id, tweet);
    onProgress({
      type: 'fetched',
      url: item.url ?? id,
      title: tweet.title ?? 'Untitled',
      chars: item.text.length,
    });
  }

  const { total } = await saveCorpus(outPath, username, displayName, byId);
  onProgress({ type: 'saved', total });
  return { added, total };
};

function resolveInputPath(username: string, urls: string[]): string {
  // If the caller passed a single .json path as the "url", treat it as the
  // manifest. Makes the CLI feel natural:
  //   pnpm fetch-essays paulg ./my-essays.json
  const explicit = urls.find((u) => u.toLowerCase().endsWith('.json'));
  if (explicit) return resolve(explicit);
  if (process.env.ESSAY_FILE_PATH) return resolve(process.env.ESSAY_FILE_PATH);
  return resolve(process.cwd(), 'data', `${username}.essays.import.json`);
}
