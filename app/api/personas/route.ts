import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { fetchTweets } from '@/lib/fetch';
import { embedTweets } from '@/lib/embed';
import {
  discoverRssUrls,
  discoverSitemapUrls,
  fetchEssays,
} from '@/lib/fetch-essays';
import { fetchYouTubeTranscripts } from '@/lib/fetch-youtube';
import { corpusPath, type Corpus } from '@/lib/persona';

export const maxDuration = 300;

// Slugs that would shadow first-class top-level routes if used as a persona
// username. The chat lives at `/<slug>`, so `/compare`, `/evals`, etc. need
// to stay reachable. Add new entries here whenever a new top-level route is
// introduced. Case-insensitive comparison since the regex allows mixed case.
const RESERVED_SLUGS = new Set([
  'api',
  'compare',
  'evals',
  'settings',
  '_next',
  'new',
  'groups',
]);

const Body = z.object({
  username: z
    .string()
    .min(1)
    .max(40)
    // Hyphens allowed so prior-only slugs like "steve-jobs" work alongside
    // X-handle slugs. Filesystem (data/<slug>.json) and the /<slug> route
    // both handle hyphens fine.
    .regex(/^[a-zA-Z0-9_-]+$/, 'Use only letters, numbers, hyphens, and underscores')
    .refine((s) => !RESERVED_SLUGS.has(s.toLowerCase()), {
      message: 'That slug is reserved by a built-in route. Try a different name.',
    }),
  mode: z.enum(['latest', 'deep', 'skip', 'prior-only']).optional(),
  // Legacy field — translated to mode below
  deep: z.boolean().optional(),
  // Prior-only personas: the displayName drives the "you are <name>" prompt.
  // bio is an optional one-line note from disambiguation injected as context.
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(200).optional(),
  essayRss: z.string().url().optional().or(z.literal('')),
  essaySitemap: z.string().url().optional().or(z.literal('')),
  essayUrls: z.array(z.string().url()).max(500).optional(),
  youtubeUrls: z.array(z.string().min(1)).max(500).optional(),
});

function resolveMode(body: z.infer<typeof Body>): 'latest' | 'deep' | 'skip' {
  // Prior-only is handled before this is called; the remaining flow only
  // cares about the tweet-fetch mode.
  if (body.mode && body.mode !== 'prior-only') return body.mode;
  return body.deep ? 'deep' : 'latest';
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const { username } = body;

  // Prior-only personas skip the entire ingestion pipeline. We persist a
  // corpus stub (empty tweets, mode flag, optional bio) and let the chat
  // route's static-prompt branch handle the rest. No Apify token or
  // embedding provider needed.
  if (body.mode === 'prior-only') {
    if (!body.displayName) {
      return Response.json(
        { error: 'Prior-only personas need a displayName.' },
        { status: 400 },
      );
    }
    const stub: Corpus = {
      username,
      displayName: body.displayName,
      fetchedAt: new Date().toISOString(),
      tweets: [],
      mode: 'prior-only',
      ...(body.bio ? { bio: body.bio } : {}),
    };
    const path = corpusPath(username);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(stub, null, 2), 'utf8');
    const enc = new TextEncoder();
    const lines =
      JSON.stringify({ stage: 'created', username, mode: 'prior-only' }) +
      '\n' +
      JSON.stringify({ stage: 'done', username }) +
      '\n';
    return new Response(enc.encode(lines), {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const mode = resolveMode(body);

  // Tweet ingestion needs *some* provider configured. Apify needs APIFY_TOKEN;
  // the file ingester just needs a local JSON file. `mode === 'skip'` means
  // the caller doesn't want tweets this time around (essays/YouTube only).
  if (mode !== 'skip') {
    const provider = (process.env.TWEET_PROVIDER ?? 'apify').toLowerCase();
    if (provider === 'apify' && !process.env.APIFY_TOKEN) {
      return Response.json(
        {
          error:
            'Server missing APIFY_TOKEN. Set it, or switch TWEET_PROVIDER=file and point TWEET_FILE_PATH at a JSON export.',
        },
        { status: 500 },
      );
    }
  }
  // Embeddings need *an* embedding provider — OpenAI directly, or an
  // openai-compatible backend (Ollama, OpenRouter, vLLM, ...). If none is
  // configured we skip the embed step; chat still works in BM25-only mode.
  const hasEmbeddingProvider = Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.EMBEDDING_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.EMBEDDING_BASE_URL ||
      process.env.LLM_BASE_URL,
  );
  if (!hasEmbeddingProvider) {
    return Response.json(
      {
        error:
          'No embedding provider configured. Set OPENAI_API_KEY, or EMBEDDING_BASE_URL for an openai-compatible backend (Ollama, vLLM, OpenRouter, ...).',
      },
      { status: 500 },
    );
  }

  const hasEssaySources =
    (body.essayRss && body.essayRss.length > 0) ||
    (body.essaySitemap && body.essaySitemap.length > 0) ||
    (body.essayUrls && body.essayUrls.length > 0);
  const hasYoutubeSources = (body.youtubeUrls?.length ?? 0) > 0;

  if (mode === 'skip' && !hasEssaySources && !hasYoutubeSources) {
    return Response.json(
      { error: 'Nothing to fetch — pick a tweet mode or add an essay/YouTube source.' },
      { status: 400 },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        // 1. Tweets
        if (mode !== 'skip') {
          send({ stage: 'fetch-start', username });
          await fetchTweets(username, { deep: mode === 'deep' }, (event) =>
            send({ stage: 'fetch', ...event }),
          );
        }

        // 2. Essays — discover from RSS / sitemap, merge with direct URLs
        const essayUrls: string[] = [];
        if (body.essayRss) {
          send({ stage: 'essays-discover', via: 'rss', url: body.essayRss });
          try {
            const urls = await discoverRssUrls(body.essayRss);
            essayUrls.push(...urls);
            send({ stage: 'essays-discovered', via: 'rss', count: urls.length });
          } catch (err) {
            send({
              stage: 'essays-discover-failed',
              via: 'rss',
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (body.essaySitemap) {
          send({ stage: 'essays-discover', via: 'sitemap', url: body.essaySitemap });
          try {
            const urls = await discoverSitemapUrls(body.essaySitemap);
            essayUrls.push(...urls);
            send({ stage: 'essays-discovered', via: 'sitemap', count: urls.length });
          } catch (err) {
            send({
              stage: 'essays-discover-failed',
              via: 'sitemap',
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (body.essayUrls) essayUrls.push(...body.essayUrls);
        // Dedupe
        const uniqueEssayUrls = Array.from(new Set(essayUrls));

        if (uniqueEssayUrls.length > 0) {
          send({ stage: 'essays-start', username, total: uniqueEssayUrls.length });
          await fetchEssays(username, uniqueEssayUrls, (event) =>
            send({ stage: 'essays', ...event }),
          );
        }

        // 3. YouTube transcripts
        if (body.youtubeUrls && body.youtubeUrls.length > 0) {
          send({ stage: 'youtube-start', username, total: body.youtubeUrls.length });
          await fetchYouTubeTranscripts(username, body.youtubeUrls, (event) =>
            send({ stage: 'youtube', ...event }),
          );
        }

        // 4. Embed everything
        send({ stage: 'embed-start', username });
        await embedTweets(username, {}, (event) => send({ stage: 'embed', ...event }));

        send({ stage: 'done', username });
      } catch (err) {
        send({
          stage: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
