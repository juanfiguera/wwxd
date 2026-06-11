import { getYouTubeIngester } from './ingest';
import type { YouTubeProgress, YouTubeResult } from './ingest';

// Re-export the parsers + ID extractor so existing imports keep working.
export {
  extractCaptionTracks,
  extractChannelName,
  extractVideoId,
  extractVideoTitle,
  parseCaptionXml,
} from './ingest/youtube-http';

/**
 * Public YouTube-ingest entrypoint. Dispatches to the configured provider
 * (YOUTUBE_PROVIDER env: http | file).
 */
export async function fetchYouTubeTranscripts(
  username: string,
  videoInputs: string[],
  onProgress: (event: YouTubeProgress) => void = () => {},
): Promise<YouTubeResult> {
  const ingest = getYouTubeIngester();
  return ingest(username, videoInputs, onProgress);
}

export type { YouTubeProgress, YouTubeResult };
