import { ApifyClient } from 'apify-client';
import {
  corpusPath,
  loadExistingCorpus,
  normalizeRawTweet,
  RawTweet,
  saveCorpus,
} from './corpus-io';
import type {
  FetchOptions,
  FetchProgress,
  FetchResult,
  Tweet,
  TweetIngester,
} from './types';

const DEFAULT_ACTOR = process.env.APIFY_ACTOR ?? 'apidojo/tweet-scraper';

type ActorResult = { tweets: Tweet[]; displayName: string };

async function runActor(
  client: ApifyClient,
  username: string,
  maxItems: number,
  start?: string,
  end?: string,
): Promise<ActorResult> {
  const input: Record<string, unknown> = {
    twitterHandles: [username],
    maxItems,
    sort: 'Latest',
  };
  if (start) input.start = start;
  if (end) input.end = end;

  const run = await client.actor(DEFAULT_ACTOR).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const tweets: Tweet[] = [];
  let displayName = '';
  for (const item of items) {
    const parsed = RawTweet.safeParse(item);
    if (!parsed.success) continue;
    if (!displayName && parsed.data.author?.name) displayName = parsed.data.author.name;
    const tweet = normalizeRawTweet(parsed.data);
    if (tweet) tweets.push(tweet);
  }
  return { tweets, displayName };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsAgo(months: number, from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() - months);
  return d;
}

export const apifyIngester: TweetIngester = async function apifyIngester(
  username: string,
  opts: FetchOptions,
  onProgress: (event: FetchProgress) => void,
): Promise<FetchResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Missing APIFY_TOKEN');

  const deep = opts.deep ?? false;
  const maxItems = opts.maxItems ?? 3000;
  const earliestYear = opts.earliestYear ?? 2010;
  const windowMonths = opts.windowMonths ?? 6;
  const emptyLimit = opts.emptyWindowLimit ?? 3;

  const outPath = corpusPath(username);
  const client = new ApifyClient({ token });
  const existing = await loadExistingCorpus(outPath);
  const byId = new Map<string, Tweet>();
  for (const t of existing?.tweets ?? []) byId.set(t.id, t);
  let displayName = existing?.displayName || '';

  onProgress({ type: 'start', username, deep });

  if (deep) {
    let end = new Date();
    let emptyStreak = 0;
    while (end.getFullYear() >= earliestYear) {
      const start = monthsAgo(windowMonths, end);
      const startStr = isoDate(start);
      const endStr = isoDate(end);
      onProgress({ type: 'window', start: startStr, end: endStr });
      const before = byId.size;
      try {
        const { tweets, displayName: name } = await runActor(
          client,
          username,
          maxItems,
          startStr,
          endStr,
        );
        if (!displayName && name) displayName = name;
        for (const t of tweets) byId.set(t.id, t);
        const { total, originals } = await saveCorpus(outPath, username, displayName, byId);
        onProgress({ type: 'window-done', added: byId.size - before, total, originals });
        if (byId.size === before) emptyStreak += 1;
        else emptyStreak = 0;
        if (emptyStreak >= emptyLimit) break;
      } catch (err) {
        onProgress({
          type: 'window-error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      end = start;
    }
  } else {
    onProgress({ type: 'window' });
    const { tweets, displayName: name } = await runActor(client, username, maxItems);
    if (!displayName && name) displayName = name;
    for (const t of tweets) byId.set(t.id, t);
  }

  const { total, originals } = await saveCorpus(outPath, username, displayName, byId);
  onProgress({ type: 'saved', total, originals, displayName: displayName || username });
  return { total, originals, displayName: displayName || username };
};
