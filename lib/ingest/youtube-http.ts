import { saveCorpus, startCorpusMerge } from './corpus-io';
import type {
  Tweet,
  YouTubeIngester,
  YouTubeProgress,
  YouTubeResult,
} from './types';

const VIDEO_ID_PATTERN = /[a-zA-Z0-9_-]{11}/;

export function extractVideoId(input: string): string | null {
  if (VIDEO_ID_PATTERN.test(input) && input.length === 11) return input;
  const short = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short) return short[1];
  const watch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watch) return watch[1];
  const embed = input.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embed) return embed[1];
  const shorts = input.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shorts) return shorts[1];
  return null;
}

export type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: string;
};

export function extractCaptionTracks(html: string): CaptionTrack[] {
  const tracklist = html.match(/"captionTracks":(\[.*?\])/s);
  if (!tracklist) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(tracklist[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const tracks: CaptionTrack[] = [];
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) continue;
    const obj = t as Record<string, unknown>;
    const baseUrl = obj.baseUrl;
    const languageCode = obj.languageCode;
    if (typeof baseUrl !== 'string' || typeof languageCode !== 'string') continue;
    tracks.push({
      baseUrl: baseUrl.replace(/\\u0026/g, '&'),
      languageCode,
      kind: typeof obj.kind === 'string' ? obj.kind : undefined,
    });
  }
  return tracks;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

export function extractVideoTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeHtmlEntities(og[1]);
  const tag = html.match(/<title>([^<]+)<\/title>/i);
  if (tag) return decodeHtmlEntities(tag[1].replace(/\s*-\s*YouTube\s*$/i, ''));
  return 'Untitled video';
}

export function extractChannelName(html: string): string {
  const match = html.match(/"author":"([^"]+)"/);
  return match ? decodeHtmlEntities(match[1]) : '';
}

export function parseCaptionXml(xml: string): string {
  const lines: string[] = [];
  const re = /<text[^>]*>([^<]+)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    lines.push(decodeHtmlEntities(m[1]));
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

function pickPreferredTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const manualEn = tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr');
  if (manualEn) return manualEn;
  const anyEn = tracks.find((t) => t.languageCode.startsWith('en'));
  if (anyEn) return anyEn;
  return tracks[0];
}

async function fetchTranscriptForVideo(videoId: string): Promise<{
  title: string;
  channel: string;
  text: string;
}> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching watch page`);
  const html = await res.text();
  const tracks = extractCaptionTracks(html);
  const track = pickPreferredTrack(tracks);
  if (!track) throw new Error('No captions available for this video');

  const captionsRes = await fetch(track.baseUrl);
  if (!captionsRes.ok) {
    throw new Error(`Captions fetch failed: HTTP ${captionsRes.status}`);
  }
  const xml = await captionsRes.text();
  const text = parseCaptionXml(xml);
  return {
    title: extractVideoTitle(html),
    channel: extractChannelName(html),
    text,
  };
}

export const youtubeHttpIngester: YouTubeIngester = async function youtubeHttpIngester(
  username: string,
  videoInputs: string[],
  onProgress: (event: YouTubeProgress) => void,
): Promise<YouTubeResult> {
  const { outPath, byId, initialDisplayName } = await startCorpusMerge(username);
  const displayName = initialDisplayName;

  const videoIds: string[] = [];
  for (const input of videoInputs) {
    const id = extractVideoId(input);
    if (id) videoIds.push(id);
    else
      onProgress({
        type: 'failed',
        videoId: input,
        message: 'not a valid YouTube URL or ID',
      });
  }

  onProgress({ type: 'start', total: videoIds.length });

  let added = 0;
  for (const videoId of videoIds) {
    try {
      const { title, text } = await fetchTranscriptForVideo(videoId);
      if (text.length < 200) {
        onProgress({
          type: 'failed',
          videoId,
          message: `transcript only ${text.length} chars`,
        });
        continue;
      }
      const id = `yt-${videoId}`;
      const item: Tweet = {
        id,
        url: `https://youtu.be/${videoId}`,
        text,
        title,
        createdAt: '',
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
      byId.set(id, item);
      onProgress({ type: 'fetched', videoId, title, chars: text.length });
    } catch (err) {
      onProgress({
        type: 'failed',
        videoId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { total } = await saveCorpus(outPath, username, displayName, byId);
  onProgress({ type: 'saved', total });
  return { added, total };
};
