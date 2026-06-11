import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tweetIngester = vi.fn(async () => ({ total: 1, originals: 1, displayName: 'X' }));
const essayIngester = vi.fn(async () => ({ added: 1, total: 1 }));
const youtubeIngester = vi.fn(async () => ({ added: 1, total: 1 }));

vi.mock('../ingest', async () => {
  const actual = await vi.importActual<typeof import('../ingest')>('../ingest');
  return {
    ...actual,
    getTweetIngester: vi.fn(() => tweetIngester),
    getEssayIngester: vi.fn(() => essayIngester),
    getYouTubeIngester: vi.fn(() => youtubeIngester),
  };
});

import { fetchTweets } from '../fetch';
import {
  fetchEssays,
  discoverRssUrls,
  extractMainText,
  extractTitle,
  parseRssUrls,
  parseSitemapXml,
} from '../fetch-essays';
import {
  fetchYouTubeTranscripts,
  extractCaptionTracks,
  extractChannelName,
  extractVideoId,
  extractVideoTitle,
  parseCaptionXml,
} from '../fetch-youtube';

beforeEach(() => {
  tweetIngester.mockClear();
  essayIngester.mockClear();
  youtubeIngester.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('lib/fetch.ts (tweet shim)', () => {
  it('delegates to the configured tweet ingester with the same args', async () => {
    const onProgress = () => {};
    const result = await fetchTweets('alice', { deep: true }, onProgress);
    expect(result.total).toBe(1);
    expect(tweetIngester).toHaveBeenCalledExactlyOnceWith('alice', { deep: true }, onProgress);
  });

  it('passes an empty opts object and a no-op progress when none provided', async () => {
    await fetchTweets('bob');
    expect(tweetIngester).toHaveBeenCalledOnce();
    const call = tweetIngester.mock.calls[0] as unknown as [string, object, unknown];
    expect(call[1]).toEqual({});
    expect(typeof call[2]).toBe('function');
  });
});

describe('lib/fetch-essays.ts (essay shim)', () => {
  it('delegates to the configured essay ingester', async () => {
    const urls = ['https://x.com', 'https://y.com'];
    const result = await fetchEssays('paulg', urls, () => {});
    expect(result.added).toBe(1);
    expect(essayIngester).toHaveBeenCalledOnce();
    const call = essayIngester.mock.calls[0] as unknown as [string, string[], unknown];
    expect(call[0]).toBe('paulg');
    expect(call[1]).toBe(urls);
  });

  it('re-exports the parser helpers so they keep working from the shim path', () => {
    // Spot-check that the re-exports actually point at the real functions.
    expect(typeof extractTitle).toBe('function');
    expect(typeof extractMainText).toBe('function');
    expect(typeof parseRssUrls).toBe('function');
    expect(typeof parseSitemapXml).toBe('function');
    expect(typeof discoverRssUrls).toBe('function');
    expect(extractTitle('<title>Hi</title>')).toBe('Hi');
    expect(parseRssUrls('<item><link>https://a</link></item>')).toEqual(['https://a']);
  });
});

describe('lib/fetch-youtube.ts (youtube shim)', () => {
  it('delegates to the configured youtube ingester', async () => {
    const result = await fetchYouTubeTranscripts('lex', ['https://youtu.be/abc'], () => {});
    expect(result.added).toBe(1);
    expect(youtubeIngester).toHaveBeenCalledOnce();
  });

  it('re-exports the parser helpers', () => {
    expect(typeof extractVideoId).toBe('function');
    expect(typeof extractCaptionTracks).toBe('function');
    expect(typeof extractChannelName).toBe('function');
    expect(typeof extractVideoTitle).toBe('function');
    expect(typeof parseCaptionXml).toBe('function');
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
});
