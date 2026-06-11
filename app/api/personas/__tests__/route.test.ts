import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchTweetsMock, embedTweetsMock, fetchEssaysMock, fetchYouTubeMock } =
  vi.hoisted(() => ({
    fetchTweetsMock: vi.fn(),
    embedTweetsMock: vi.fn(),
    fetchEssaysMock: vi.fn(),
    fetchYouTubeMock: vi.fn(),
  }));

vi.mock('@/lib/fetch', () => ({ fetchTweets: fetchTweetsMock }));
vi.mock('@/lib/embed', () => ({ embedTweets: embedTweetsMock }));
vi.mock('@/lib/fetch-essays', () => ({
  fetchEssays: fetchEssaysMock,
  discoverRssUrls: vi.fn(async () => []),
  discoverSitemapUrls: vi.fn(async () => []),
}));
vi.mock('@/lib/fetch-youtube', () => ({
  fetchYouTubeTranscripts: fetchYouTubeMock,
}));

import { POST } from '../route';

const envBackup: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'TWEET_PROVIDER',
  'APIFY_TOKEN',
  'OPENAI_API_KEY',
  'EMBEDDING_API_KEY',
  'LLM_API_KEY',
  'EMBEDDING_BASE_URL',
  'LLM_BASE_URL',
];

beforeEach(() => {
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
  process.env.APIFY_TOKEN = 'apify-test';
  process.env.OPENAI_API_KEY = 'sk-test';

  fetchTweetsMock.mockReset();
  embedTweetsMock.mockReset();
  fetchEssaysMock.mockReset();
  fetchYouTubeMock.mockReset();
  fetchTweetsMock.mockImplementation(async (_user, _opts, cb) => {
    cb?.({ type: 'start', username: _user, deep: false });
    cb?.({ type: 'saved', total: 10, originals: 8, displayName: _user });
    return { total: 10, originals: 8, displayName: _user };
  });
  embedTweetsMock.mockImplementation(async (_user, _opts, cb) => {
    cb?.({ type: 'start', total: 10, model: 'm', dimensions: 4 });
    cb?.({ type: 'saved', total: 10 });
    return { total: 10 };
  });
  fetchEssaysMock.mockResolvedValue({ added: 0, total: 0 });
  fetchYouTubeMock.mockResolvedValue({ added: 0, total: 0 });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

function postReq(body: unknown): Request {
  return new Request('http://test.local/api/personas', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function drainStream(res: Response): Promise<unknown[]> {
  const events: unknown[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip
      }
    }
  }
  return events;
}

describe('POST /api/personas — validation', () => {
  it('rejects an invalid username (special chars)', async () => {
    const res = await POST(postReq({ username: 'bad name' }));
    expect(res.status).toBe(400);
  });

  it('rejects when mode=skip but no essay/youtube sources provided', async () => {
    const res = await POST(postReq({ username: 'alice', mode: 'skip' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Nothing to fetch/);
  });
});

describe('POST /api/personas — server preconditions', () => {
  it('returns 500 if TWEET_PROVIDER=apify but APIFY_TOKEN is missing', async () => {
    delete process.env.APIFY_TOKEN;
    const res = await POST(postReq({ username: 'alice', mode: 'latest' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/APIFY_TOKEN/);
  });

  it('allows mode=skip even when APIFY_TOKEN is missing', async () => {
    delete process.env.APIFY_TOKEN;
    const res = await POST(
      postReq({
        username: 'alice',
        mode: 'skip',
        youtubeUrls: ['https://youtu.be/dQw4w9WgXcQ'],
      }),
    );
    // mode=skip + sources present → should not 500 for APIFY
    expect(res.status).toBe(200);
  });

  it('returns 500 if no embedding provider is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.LLM_BASE_URL;
    const res = await POST(postReq({ username: 'alice', mode: 'latest' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/embedding provider/i);
  });

  it('accepts an openai-compatible base URL as the embedding provider', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    const res = await POST(postReq({ username: 'alice', mode: 'latest' }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/personas — streaming flow', () => {
  it('streams NDJSON events with the expected stages for latest mode', async () => {
    const res = await POST(postReq({ username: 'alice', mode: 'latest' }));
    expect(res.status).toBe(200);
    const events = (await drainStream(res)) as { stage: string }[];
    const stages = events.map((e) => e.stage);
    expect(stages).toContain('fetch-start');
    expect(stages).toContain('embed-start');
    expect(stages.at(-1)).toBe('done');
    expect(fetchTweetsMock).toHaveBeenCalledOnce();
    expect(embedTweetsMock).toHaveBeenCalledOnce();
  });

  it('skips the tweet fetch when mode=skip', async () => {
    const res = await POST(
      postReq({
        username: 'alice',
        mode: 'skip',
        essayUrls: ['https://example.com/post'],
      }),
    );
    expect(res.status).toBe(200);
    await drainStream(res);
    expect(fetchTweetsMock).not.toHaveBeenCalled();
    expect(fetchEssaysMock).toHaveBeenCalled();
  });

  it('runs the YouTube fetcher when youtubeUrls are present', async () => {
    const res = await POST(
      postReq({
        username: 'alice',
        mode: 'latest',
        youtubeUrls: ['https://youtu.be/dQw4w9WgXcQ'],
      }),
    );
    expect(res.status).toBe(200);
    await drainStream(res);
    expect(fetchYouTubeMock).toHaveBeenCalled();
  });

  it('streams a final "error" stage when an ingester throws', async () => {
    fetchTweetsMock.mockRejectedValueOnce(new Error('apify down'));
    const res = await POST(postReq({ username: 'alice', mode: 'latest' }));
    expect(res.status).toBe(200);
    const events = (await drainStream(res)) as { stage: string; message?: string }[];
    const error = events.find((e) => e.stage === 'error');
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/apify down/);
  });
});
