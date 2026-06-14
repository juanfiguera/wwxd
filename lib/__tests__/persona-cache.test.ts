import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCorpusBundle, invalidate, size } from '../persona-cache';

let tmpDir = '';
let originalDataDir: string | undefined;

function corpusFixture(username: string, tweetCount = 3) {
  return {
    username,
    displayName: 'Test Persona',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    tweets: Array.from({ length: tweetCount }, (_, i) => ({
      id: `${username}-tweet-${i}`,
      url: `https://x.com/${username}/status/${i}`,
      text: `tweet number ${i} from ${username}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      isReply: false,
      isRetweet: false,
      isQuote: false,
    })),
  };
}

async function writeCorpus(username: string, body = corpusFixture(username)): Promise<string> {
  const path = resolve(tmpDir, `${username}.json`);
  await writeFile(path, JSON.stringify(body), 'utf8');
  return path;
}

beforeAll(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'wwxd-persona-cache-'));
  originalDataDir = process.env.WWXD_DATA_DIR;
  process.env.WWXD_DATA_DIR = tmpDir;
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.WWXD_DATA_DIR;
  else process.env.WWXD_DATA_DIR = originalDataDir;
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  invalidate();
});

afterEach(() => {
  invalidate();
});

describe('getCorpusBundle', () => {
  it('returns the same instance on a second call for the same mtime', async () => {
    await writeCorpus('paulg');
    const a = await getCorpusBundle('paulg');
    const b = await getCorpusBundle('paulg');
    expect(b).toBe(a);
    expect(size()).toBe(1);
  });

  it('reads the corpus and builds bundle parts', async () => {
    await writeCorpus('naval', corpusFixture('naval', 5));
    const bundle = await getCorpusBundle('naval');
    expect(bundle.corpus.username).toBe('naval');
    expect(bundle.corpus.tweets).toHaveLength(5);
    expect(bundle.staticPrompt.length).toBeGreaterThan(0);
    expect(bundle.tweetById.size).toBe(5);
    expect(bundle.tweetById.get('naval-tweet-2')?.text).toContain('tweet number 2');
    expect(bundle.bm25).toBeDefined();
  });

  it('refreshes the bundle when the corpus mtime changes', async () => {
    const path = await writeCorpus('paulg', corpusFixture('paulg', 3));
    const first = await getCorpusBundle('paulg');
    expect(first.tweetById.size).toBe(3);

    // Rewrite the file with a bigger corpus AND bump the mtime forward by 5s
    // so the cache notices.
    await writeCorpus('paulg', corpusFixture('paulg', 8));
    const future = new Date(Date.now() + 5000);
    await utimes(path, future, future);

    const second = await getCorpusBundle('paulg');
    expect(second).not.toBe(first);
    expect(second.tweetById.size).toBe(8);
    expect(size()).toBe(1);
  });

  it('keeps separate entries for separate personas', async () => {
    await writeCorpus('paulg');
    await writeCorpus('naval');
    const a = await getCorpusBundle('paulg');
    const b = await getCorpusBundle('naval');
    expect(a).not.toBe(b);
    expect(a.corpus.username).toBe('paulg');
    expect(b.corpus.username).toBe('naval');
    expect(size()).toBe(2);
  });

  it('propagates a missing-corpus error', async () => {
    await expect(getCorpusBundle('does-not-exist')).rejects.toThrow();
    expect(size()).toBe(0);
  });

  it('returns the same instance for concurrent gets that arrive together', async () => {
    await writeCorpus('paulg');
    const [a, b, c] = await Promise.all([
      getCorpusBundle('paulg'),
      getCorpusBundle('paulg'),
      getCorpusBundle('paulg'),
    ]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe('invalidate', () => {
  it('drops a single entry by username', async () => {
    await writeCorpus('paulg');
    await writeCorpus('naval');
    const pgFirst = await getCorpusBundle('paulg');
    const navalFirst = await getCorpusBundle('naval');
    expect(size()).toBe(2);

    invalidate('paulg');
    expect(size()).toBe(1);

    const pgAgain = await getCorpusBundle('paulg');
    const navalAgain = await getCorpusBundle('naval');
    expect(pgAgain).not.toBe(pgFirst);
    expect(navalAgain).toBe(navalFirst);
  });

  it('clears every entry when called with no username', async () => {
    await writeCorpus('paulg');
    await writeCorpus('naval');
    await getCorpusBundle('paulg');
    await getCorpusBundle('naval');
    expect(size()).toBe(2);

    invalidate();
    expect(size()).toBe(0);
  });

  it('is safe to call on a username that was never cached', () => {
    expect(() => invalidate('never-seen')).not.toThrow();
    expect(size()).toBe(0);
  });
});
