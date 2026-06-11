import { getEssayIngester } from './ingest';
import type { EssayProgress, EssayResult } from './ingest';

// Re-export the discovery helpers + parsers so the CLI and any callers
// keep importing them from the same place.
export {
  discoverRssUrls,
  discoverSitemapUrls,
  extractMainText,
  extractTitle,
  parseRssUrls,
  parseSitemapXml,
} from './ingest/essay-http';

/**
 * Public essay-ingest entrypoint. Dispatches to the configured provider
 * (ESSAY_PROVIDER env: http | file).
 */
export async function fetchEssays(
  username: string,
  urls: string[],
  onProgress: (event: EssayProgress) => void = () => {},
): Promise<EssayResult> {
  const ingest = getEssayIngester();
  return ingest(username, urls, onProgress);
}

export type { EssayProgress, EssayResult };
