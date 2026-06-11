import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  corpusPath,
  loadExistingCorpus,
  normalizeRawTweet,
  RawTweet,
  saveCorpus,
} from './corpus-io';
import type { Corpus } from '../persona';
import type {
  FetchOptions,
  FetchProgress,
  FetchResult,
  Tweet,
  TweetIngester,
} from './types';

/**
 * Loads tweets from a local JSON file you bring yourself. Lets self-hosters
 * skip the Apify dependency (and its cost) entirely by exporting tweets from
 * the X archive, another scraper, or a Twitter API v2 export.
 *
 * Accepted shapes:
 *   - `[ { id, text, ... }, ... ]`                       (bare array of tweets)
 *   - `{ tweets: [...], displayName?, username? }`       (Corpus shape)
 *
 * Path resolution: opts.filePath → TWEET_FILE_PATH env → data/<user>.import.json.
 * Loaded tweets are merged with anything already saved to data/<user>.json
 * (so re-running with new exports adds without losing prior data).
 */
export const fileIngester: TweetIngester = async function fileIngester(
  username: string,
  opts: FetchOptions,
  onProgress: (event: FetchProgress) => void,
): Promise<FetchResult> {
  const inputPath = resolveInputPath(username, opts.filePath);
  onProgress({ type: 'start', username, deep: false });
  onProgress({ type: 'window' });

  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch (err) {
    throw new Error(
      `File ingester: could not read ${inputPath}. ` +
        `Set TWEET_FILE_PATH or pass --file <path>. (${err instanceof Error ? err.message : err})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `File ingester: ${inputPath} is not valid JSON. (${err instanceof Error ? err.message : err})`,
    );
  }

  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Corpus)?.tweets)
      ? (parsed as Corpus).tweets
      : [];
  const corpusMeta = !Array.isArray(parsed) ? (parsed as Corpus) : null;

  const outPath = corpusPath(username);
  const existing = await loadExistingCorpus(outPath);
  const byId = new Map<string, Tweet>();
  for (const t of existing?.tweets ?? []) byId.set(t.id, t);

  let displayName = existing?.displayName || corpusMeta?.displayName || '';
  let added = 0;
  for (const item of items) {
    const safe = RawTweet.safeParse(item);
    if (!safe.success) continue;
    if (!displayName && safe.data.author?.name) displayName = safe.data.author.name;
    const tweet = normalizeRawTweet(safe.data);
    if (!tweet) continue;
    if (!byId.has(tweet.id)) added += 1;
    byId.set(tweet.id, tweet);
  }

  const { total, originals } = await saveCorpus(outPath, username, displayName, byId);
  onProgress({ type: 'window-done', added, total, originals });
  onProgress({ type: 'saved', total, originals, displayName: displayName || username });
  return { total, originals, displayName: displayName || username };
};

function resolveInputPath(username: string, override?: string): string {
  if (override) return resolve(override);
  if (process.env.TWEET_FILE_PATH) return resolve(process.env.TWEET_FILE_PATH);
  return resolve(process.cwd(), 'data', `${username}.import.json`);
}
