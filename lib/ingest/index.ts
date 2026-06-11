import { apifyIngester } from './apify';
import { essayFileIngester } from './essay-file';
import { essayHttpIngester } from './essay-http';
import { fileIngester } from './file';
import { youtubeFileIngester } from './youtube-file';
import { youtubeHttpIngester } from './youtube-http';
import type {
  EssayIngester,
  TweetIngester,
  YouTubeIngester,
} from './types';

// ────────── Tweets ──────────

export type TweetProvider = 'apify' | 'file';

export function tweetProvider(): TweetProvider {
  const raw = (process.env.TWEET_PROVIDER ?? 'apify').toLowerCase();
  if (raw === 'apify' || raw === 'file') return raw;
  throw new Error(`Unknown TWEET_PROVIDER=${raw}. Use apify | file.`);
}

export function getTweetIngester(provider?: TweetProvider): TweetIngester {
  switch (provider ?? tweetProvider()) {
    case 'apify':
      return apifyIngester;
    case 'file':
      return fileIngester;
  }
}

// ────────── Essays ──────────

export type EssayProvider = 'http' | 'file';

export function essayProvider(): EssayProvider {
  const raw = (process.env.ESSAY_PROVIDER ?? 'http').toLowerCase();
  if (raw === 'http' || raw === 'file') return raw;
  throw new Error(`Unknown ESSAY_PROVIDER=${raw}. Use http | file.`);
}

export function getEssayIngester(provider?: EssayProvider): EssayIngester {
  switch (provider ?? essayProvider()) {
    case 'http':
      return essayHttpIngester;
    case 'file':
      return essayFileIngester;
  }
}

// ────────── YouTube ──────────

export type YouTubeProvider = 'http' | 'file';

export function youtubeProvider(): YouTubeProvider {
  const raw = (process.env.YOUTUBE_PROVIDER ?? 'http').toLowerCase();
  if (raw === 'http' || raw === 'file') return raw;
  throw new Error(`Unknown YOUTUBE_PROVIDER=${raw}. Use http | file.`);
}

export function getYouTubeIngester(provider?: YouTubeProvider): YouTubeIngester {
  switch (provider ?? youtubeProvider()) {
    case 'http':
      return youtubeHttpIngester;
    case 'file':
      return youtubeFileIngester;
  }
}

export type {
  EssayIngester,
  EssayProgress,
  EssayResult,
  FetchOptions,
  FetchProgress,
  FetchResult,
  TweetIngester,
  YouTubeIngester,
  YouTubeProgress,
  YouTubeResult,
} from './types';
