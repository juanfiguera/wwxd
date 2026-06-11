import type { Tweet } from '../persona';

export type FetchProgress =
  | { type: 'start'; username: string; deep: boolean }
  | { type: 'window'; start?: string; end?: string }
  | { type: 'window-done'; added: number; total: number; originals: number }
  | { type: 'window-error'; message: string }
  | { type: 'saved'; total: number; originals: number; displayName: string };

export type FetchOptions = {
  deep?: boolean;
  maxItems?: number;
  earliestYear?: number;
  windowMonths?: number;
  emptyWindowLimit?: number;
  /** File-based ingester only — path to a JSON corpus or array. Overrides
   *  TWEET_FILE_PATH from the env. Ignored by network ingesters. */
  filePath?: string;
};

export type FetchResult = {
  total: number;
  originals: number;
  displayName: string;
};

export type TweetIngester = (
  username: string,
  opts: FetchOptions,
  onProgress: (event: FetchProgress) => void,
) => Promise<FetchResult>;

// ────────── Essays ──────────

export type EssayProgress =
  | { type: 'start'; total: number }
  | { type: 'fetched'; url: string; title: string; chars: number }
  | { type: 'failed'; url: string; message: string }
  | { type: 'saved'; total: number };

export type EssayResult = { added: number; total: number };

export type EssayIngester = (
  username: string,
  urls: string[],
  onProgress: (event: EssayProgress) => void,
) => Promise<EssayResult>;

// ────────── YouTube ──────────

export type YouTubeProgress =
  | { type: 'start'; total: number }
  | { type: 'fetched'; videoId: string; title: string; chars: number }
  | { type: 'failed'; videoId: string; message: string }
  | { type: 'saved'; total: number };

export type YouTubeResult = { added: number; total: number };

export type YouTubeIngester = (
  username: string,
  videoInputs: string[],
  onProgress: (event: YouTubeProgress) => void,
) => Promise<YouTubeResult>;

export type { Tweet };
