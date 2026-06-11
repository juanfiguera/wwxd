import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apifyIngester } from '../ingest/apify';
import { essayFileIngester } from '../ingest/essay-file';
import { essayHttpIngester } from '../ingest/essay-http';
import { fileIngester } from '../ingest/file';
import {
  essayProvider,
  getEssayIngester,
  getTweetIngester,
  getYouTubeIngester,
  tweetProvider,
  youtubeProvider,
} from '../ingest';
import { youtubeFileIngester } from '../ingest/youtube-file';
import { youtubeHttpIngester } from '../ingest/youtube-http';

const ENV_KEYS = ['TWEET_PROVIDER', 'ESSAY_PROVIDER', 'YOUTUBE_PROVIDER'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('tweetProvider / getTweetIngester', () => {
  it('defaults to apify when no env is set', () => {
    delete process.env.TWEET_PROVIDER;
    expect(tweetProvider()).toBe('apify');
    expect(getTweetIngester()).toBe(apifyIngester);
  });

  it('honors TWEET_PROVIDER=file', () => {
    process.env.TWEET_PROVIDER = 'file';
    expect(tweetProvider()).toBe('file');
    expect(getTweetIngester()).toBe(fileIngester);
  });

  it('is case-insensitive', () => {
    process.env.TWEET_PROVIDER = 'FILE';
    expect(getTweetIngester()).toBe(fileIngester);
  });

  it('throws on an unknown provider', () => {
    process.env.TWEET_PROVIDER = 'mars';
    expect(() => tweetProvider()).toThrow(/Unknown TWEET_PROVIDER=mars/);
  });

  it('accepts an explicit override regardless of env', () => {
    process.env.TWEET_PROVIDER = 'apify';
    expect(getTweetIngester('file')).toBe(fileIngester);
  });
});

describe('essayProvider / getEssayIngester', () => {
  it('defaults to http', () => {
    delete process.env.ESSAY_PROVIDER;
    expect(essayProvider()).toBe('http');
    expect(getEssayIngester()).toBe(essayHttpIngester);
  });

  it('honors ESSAY_PROVIDER=file', () => {
    process.env.ESSAY_PROVIDER = 'file';
    expect(getEssayIngester()).toBe(essayFileIngester);
  });

  it('throws on an unknown provider', () => {
    process.env.ESSAY_PROVIDER = 'carrierpigeon';
    expect(() => essayProvider()).toThrow(/Unknown ESSAY_PROVIDER=carrierpigeon/);
  });
});

describe('youtubeProvider / getYouTubeIngester', () => {
  it('defaults to http', () => {
    delete process.env.YOUTUBE_PROVIDER;
    expect(youtubeProvider()).toBe('http');
    expect(getYouTubeIngester()).toBe(youtubeHttpIngester);
  });

  it('honors YOUTUBE_PROVIDER=file', () => {
    process.env.YOUTUBE_PROVIDER = 'file';
    expect(getYouTubeIngester()).toBe(youtubeFileIngester);
  });

  it('throws on an unknown provider', () => {
    process.env.YOUTUBE_PROVIDER = 'vhs';
    expect(() => youtubeProvider()).toThrow(/Unknown YOUTUBE_PROVIDER=vhs/);
  });
});
