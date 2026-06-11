import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { youtubeHttpIngester } from '../ingest/youtube-http';
import { loadCorpus } from '../persona';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-youtube-http-'));
const originalCwd = process.cwd();

beforeAll(() => process.chdir(tmp));
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

const savedFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

function watchPageWithCaptions(opts: {
  title?: string;
  author?: string;
  captionBaseUrl?: string;
}): string {
  const captions = opts.captionBaseUrl
    ? `"captionTracks":[{"baseUrl":"${opts.captionBaseUrl}","languageCode":"en","kind":""}]`
    : '"captionTracks":[]';
  return `<html>
    <head>
      <meta property="og:title" content="${opts.title ?? 'Test Talk'}">
    </head>
    <body>
      <script>var data = {${captions},"author":"${opts.author ?? 'A Channel'}"};</script>
    </body>
  </html>`;
}

function captionXml(text: string): string {
  // Simulate the line-by-line format YouTube returns.
  return `<?xml version="1.0"?><transcript>
    <text start="0">${text}</text>
  </transcript>`;
}

describe('youtubeHttpIngester orchestration', () => {
  it('fetches watch page + captions and writes the corpus', async () => {
    const longText = 'this is a long transcript '.repeat(15); // > 200 chars
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          watchPageWithCaptions({
            title: 'Ep 1',
            author: 'Lex Fridman',
            captionBaseUrl: 'https://yt.com/cap1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(captionXml(longText), { status: 200 }));

    const events: string[] = [];
    const result = await youtubeHttpIngester(
      'lex',
      ['https://youtu.be/dQw4w9WgXcQ'],
      (e) => events.push(e.type),
    );
    expect(result.added).toBe(1);
    expect(events).toContain('fetched');

    const corpus = await loadCorpus('lex');
    expect(corpus.tweets).toHaveLength(1);
    expect(corpus.tweets[0].source).toBe('transcript');
    expect(corpus.tweets[0].title).toBe('Ep 1');
    expect(corpus.tweets[0].id).toMatch(/^yt-/);
  });

  it('reports failure when no caption track is found', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(watchPageWithCaptions({}), { status: 200 }),
    );
    const events: { type: string; message?: string }[] = [];
    const result = await youtubeHttpIngester(
      'cap',
      ['https://youtu.be/dQw4w9WgXcQ'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(result.added).toBe(0);
    expect(events.some((e) => e.type === 'failed' && /no captions/i.test(e.message ?? ''))).toBe(true);
  });

  it('reports failure on HTTP 404 from the watch page', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('gone', { status: 404 }),
    );
    const events: { type: string; message?: string }[] = [];
    await youtubeHttpIngester(
      'g',
      ['https://youtu.be/aaaaaaaaaaa'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(events.some((e) => e.type === 'failed' && (e.message ?? '').includes('404'))).toBe(
      true,
    );
  });

  it('reports failure when captions endpoint returns non-2xx', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          watchPageWithCaptions({ captionBaseUrl: 'https://yt.com/cap-broken' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 500 }));

    const events: { type: string; message?: string }[] = [];
    await youtubeHttpIngester('h', ['https://youtu.be/bbbbbbbbbbb'], (e) =>
      events.push(e as { type: string; message?: string }),
    );
    expect(events.some((e) => e.type === 'failed' && (e.message ?? '').includes('500'))).toBe(
      true,
    );
  });

  it('rejects invalid video URLs before any fetch', async () => {
    const events: { type: string; message?: string }[] = [];
    const result = await youtubeHttpIngester(
      'i',
      ['not a youtube url'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(result.added).toBe(0);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'failed')).toBe(true);
  });

  it('reports failure when the transcript text is too short', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          watchPageWithCaptions({ captionBaseUrl: 'https://yt.com/cap-short' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(captionXml('um hi'), { status: 200 }));
    const events: { type: string; message?: string }[] = [];
    await youtubeHttpIngester(
      'short',
      ['https://youtu.be/ccccccccccc'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(events.some((e) => e.type === 'failed' && /transcript only/.test(e.message ?? ''))).toBe(
      true,
    );
  });
});
