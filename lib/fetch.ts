import { getTweetIngester } from './ingest';
import type {
  FetchOptions,
  FetchProgress,
  FetchResult,
} from './ingest';

/**
 * Public tweet-ingest entrypoint. Dispatches to the configured provider
 * (TWEET_PROVIDER env: apify | file). Used by the CLI and the in-app
 * "add persona" flow alike — both stay agnostic of where the tweets came
 * from.
 */
export async function fetchTweets(
  username: string,
  opts: FetchOptions = {},
  onProgress: (event: FetchProgress) => void = () => {},
): Promise<FetchResult> {
  const ingest = getTweetIngester();
  return ingest(username, opts, onProgress);
}

export type { FetchOptions, FetchProgress, FetchResult };
