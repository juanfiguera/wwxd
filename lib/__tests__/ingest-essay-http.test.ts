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
import { discoverRssUrls, discoverSitemapUrls, essayHttpIngester } from '../ingest/essay-http';
import { loadCorpus } from '../persona';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-essay-http-'));
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

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

describe('essayHttpIngester orchestration', () => {
  it('fetches each URL, extracts text, and writes the corpus', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const longText = 'Lorem ipsum '.repeat(40); // > 200 chars after stripping
      return jsonResponse(`
        <html>
          <head><meta property="og:title" content="Title for ${url}"></head>
          <article>${longText}</article>
        </html>
      `);
    });

    const events: string[] = [];
    const result = await essayHttpIngester(
      'alice',
      ['https://example.com/a', 'https://example.com/b'],
      (e) => events.push(e.type),
    );
    expect(result.added).toBe(2);
    expect(result.total).toBe(2);
    expect(events).toContain('start');
    expect(events.filter((t) => t === 'fetched')).toHaveLength(2);
    expect(events).toContain('saved');

    const corpus = await loadCorpus('alice');
    expect(corpus.tweets.every((t) => t.source === 'essay')).toBe(true);
    expect(corpus.tweets.every((t) => t.title?.startsWith('Title for'))).toBe(true);
  });

  it('reports failure when extracted text is too short', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse('<html><body>tiny</body></html>'),
    );
    const events: { type: string; message?: string }[] = [];
    const result = await essayHttpIngester(
      'bob',
      ['https://example.com/short'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(result.added).toBe(0);
    const failure = events.find((e) => e.type === 'failed');
    expect(failure).toBeDefined();
    expect(failure!.message).toMatch(/only \d+ chars/);
  });

  it('reports failure on HTTP non-2xx without throwing the whole run', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    );
    const events: { type: string; message?: string }[] = [];
    const result = await essayHttpIngester(
      'carol',
      ['https://example.com/missing'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(result.added).toBe(0);
    expect(events.some((e) => e.type === 'failed' && e.message?.includes('404'))).toBe(true);
  });

  it('reports failure on network error without throwing', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('ENETDOWN'));
    const events: { type: string; message?: string }[] = [];
    await essayHttpIngester(
      'dave',
      ['https://example.com/broken'],
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(events.some((e) => e.type === 'failed' && e.message?.includes('ENETDOWN'))).toBe(
      true,
    );
  });
});

describe('discoverRssUrls', () => {
  it('parses RSS <item><link> entries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(`<?xml version="1.0"?><rss><channel>
        <item><link>https://blog.com/post-1</link></item>
        <item><link>https://blog.com/post-2</link></item>
      </channel></rss>`),
    );
    const urls = await discoverRssUrls('https://blog.com/feed.xml');
    expect(urls.sort()).toEqual(['https://blog.com/post-1', 'https://blog.com/post-2']);
  });

  it('parses Atom <entry><link href> entries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(`<?xml version="1.0"?><feed>
        <entry><link href="https://atom.com/post-a"/></entry>
        <entry><link href="https://atom.com/post-b"/></entry>
      </feed>`),
    );
    const urls = await discoverRssUrls('https://atom.com/feed');
    expect(urls.sort()).toEqual(['https://atom.com/post-a', 'https://atom.com/post-b']);
  });

  it('throws on HTTP error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('nope', { status: 500 }),
    );
    await expect(discoverRssUrls('https://broken.com/feed')).rejects.toThrow(/HTTP 500/);
  });
});

describe('discoverSitemapUrls', () => {
  it('returns URLs from a plain sitemap', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(`<?xml version="1.0"?><urlset>
        <url><loc>https://example.com/a</loc></url>
        <url><loc>https://example.com/b</loc></url>
      </urlset>`),
    );
    const urls = await discoverSitemapUrls('https://example.com/sitemap.xml');
    expect(urls.sort()).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('recurses into sitemap indexes', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse(`<?xml version="1.0"?><sitemapindex>
          <sitemap><loc>https://example.com/posts.xml</loc></sitemap>
        </sitemapindex>`),
      )
      .mockResolvedValueOnce(
        jsonResponse(`<?xml version="1.0"?><urlset>
          <url><loc>https://example.com/post-1</loc></url>
        </urlset>`),
      );
    const urls = await discoverSitemapUrls('https://example.com/sitemap.xml');
    expect(urls).toEqual(['https://example.com/post-1']);
  });

  it('throws on HTTP error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('nope', { status: 503 }),
    );
    await expect(
      discoverSitemapUrls('https://broken.com/sitemap.xml'),
    ).rejects.toThrow(/HTTP 503/);
  });
});
