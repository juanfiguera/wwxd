import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { saveCorpus, startCorpusMerge } from './corpus-io';
import type {
  Tweet,
  YouTubeIngester,
  YouTubeProgress,
  YouTubeResult,
} from './types';

/**
 * Loads YouTube transcripts from a JSON file you bring yourself. Useful
 * when YouTube's HTML scraping breaks (it does, regularly), when you've
 * paid a transcription service for cleaner output, or when you have access
 * to internal transcripts wwxd can't reach.
 *
 * Accepted shapes:
 *   - Bare array:  `[ { videoId, title?, text, createdAt? }, ... ]`
 *   - Manifest:    `{ displayName?, videos: [ ... ] }`
 *
 * Path resolution: first CLI arg if it ends in .json → YOUTUBE_FILE_PATH
 * env → data/<username>.youtube.import.json.
 */

const Video = z.object({
  videoId: z.string().min(1),
  title: z.string().optional(),
  text: z.string().min(1),
  createdAt: z.string().optional(),
});
type Video = z.infer<typeof Video>;

const Manifest = z.union([
  z.array(Video),
  z.object({
    displayName: z.string().optional(),
    videos: z.array(Video),
  }),
]);

export const youtubeFileIngester: YouTubeIngester = async function youtubeFileIngester(
  username: string,
  videoInputs: string[],
  onProgress: (event: YouTubeProgress) => void,
): Promise<YouTubeResult> {
  const inputPath = resolveInputPath(username, videoInputs);
  const raw = await readFile(inputPath, 'utf8').catch((err) => {
    throw new Error(
      `YouTube file ingester: could not read ${inputPath}. ` +
        `Pass the path as the first arg (must end in .json), ` +
        `set YOUTUBE_FILE_PATH, or drop a file at data/${username}.youtube.import.json. ` +
        `(${err instanceof Error ? err.message : err})`,
    );
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `YouTube file ingester: ${inputPath} is not valid JSON. ` +
        `(${err instanceof Error ? err.message : err})`,
    );
  }
  const manifest = Manifest.safeParse(parsed);
  if (!manifest.success) {
    throw new Error(
      `YouTube file ingester: ${inputPath} doesn't match the expected shape ` +
        `([{ videoId, text, ... }] or { videos: [...] }). ` +
        `Issue: ${manifest.error.issues[0]?.message}`,
    );
  }
  const items: Video[] = Array.isArray(manifest.data)
    ? manifest.data
    : manifest.data.videos;
  const manifestDisplayName = Array.isArray(manifest.data)
    ? null
    : manifest.data.displayName ?? null;

  const { outPath, byId, initialDisplayName } = await startCorpusMerge(username);
  const displayName =
    manifestDisplayName && initialDisplayName === username
      ? manifestDisplayName
      : initialDisplayName;

  onProgress({ type: 'start', total: items.length });

  let added = 0;
  for (const item of items) {
    if (item.text.length < 50) {
      onProgress({
        type: 'failed',
        videoId: item.videoId,
        message: `transcript too short (${item.text.length} chars)`,
      });
      continue;
    }
    const id = `yt-${item.videoId}`;
    const tweet: Tweet = {
      id,
      url: `https://youtu.be/${item.videoId}`,
      text: item.text,
      title: item.title ?? 'Untitled video',
      createdAt: item.createdAt ?? '',
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      isReply: false,
      isRetweet: false,
      isQuote: false,
      source: 'transcript' as const,
    };
    if (!byId.has(id)) added += 1;
    byId.set(id, tweet);
    onProgress({
      type: 'fetched',
      videoId: item.videoId,
      title: tweet.title ?? 'Untitled video',
      chars: item.text.length,
    });
  }

  const { total } = await saveCorpus(outPath, username, displayName, byId);
  onProgress({ type: 'saved', total });
  return { added, total };
};

function resolveInputPath(username: string, videoInputs: string[]): string {
  const explicit = videoInputs.find((u) => u.toLowerCase().endsWith('.json'));
  if (explicit) return resolve(explicit);
  if (process.env.YOUTUBE_FILE_PATH) return resolve(process.env.YOUTUBE_FILE_PATH);
  return resolve(process.cwd(), 'data', `${username}.youtube.import.json`);
}
