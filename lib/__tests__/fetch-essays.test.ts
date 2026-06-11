import { describe, it, expect } from 'vitest';
import {
  extractMainText,
  extractTitle,
  parseRssUrls,
  parseSitemapXml,
} from '../fetch-essays';

describe('extractTitle', () => {
  it('prefers og:title', () => {
    const html =
      '<head><meta property="og:title" content="The Real Title"><title>Fallback</title></head>';
    expect(extractTitle(html)).toBe('The Real Title');
  });

  it('falls back to title tag', () => {
    expect(extractTitle('<head><title>Hello World</title></head>')).toBe('Hello World');
  });

  it('falls back to h1', () => {
    expect(extractTitle('<h1>An Essay</h1>')).toBe('An Essay');
  });

  it('decodes entities', () => {
    expect(extractTitle('<title>Tom &amp; Jerry</title>')).toBe('Tom & Jerry');
  });

  it('returns Untitled if nothing found', () => {
    expect(extractTitle('<div>no title</div>')).toBe('Untitled');
  });
});

describe('extractMainText', () => {
  it('prefers article content', () => {
    const html = `
      <html><body>
        <nav>navigation</nav>
        <article><p>The real content</p></article>
        <footer>footer text</footer>
      </body></html>
    `;
    const text = extractMainText(html);
    expect(text).toContain('The real content');
    expect(text).not.toContain('navigation');
    expect(text).not.toContain('footer text');
  });

  it('falls back to main when article missing', () => {
    const html = `<body><main><p>Main content</p></main></body>`;
    expect(extractMainText(html)).toContain('Main content');
  });

  it('strips scripts and styles', () => {
    const html = `
      <body>
        <script>console.log("secret");</script>
        <style>.foo { color: red; }</style>
        <article>visible</article>
      </body>
    `;
    const text = extractMainText(html);
    expect(text).toContain('visible');
    expect(text).not.toContain('console.log');
    expect(text).not.toContain('color: red');
  });

  it('preserves paragraph breaks', () => {
    const html = `<article><p>First.</p><p>Second.</p></article>`;
    const text = extractMainText(html);
    expect(text).toContain('First.');
    expect(text).toContain('Second.');
  });

  it('decodes common entities', () => {
    expect(extractMainText('<article>Tom &amp; Jerry &nbsp;here</article>')).toContain(
      'Tom & Jerry here',
    );
  });
});

describe('parseRssUrls', () => {
  it('extracts links from RSS 2.0', () => {
    const xml = `<?xml version="1.0"?>
<rss>
  <channel>
    <link>https://example.com</link>
    <item><link>https://example.com/post-1</link></item>
    <item><link>https://example.com/post-2</link></item>
  </channel>
</rss>`;
    expect(parseRssUrls(xml)).toEqual(['https://example.com/post-1', 'https://example.com/post-2']);
  });

  it('extracts links from Atom', () => {
    const xml = `<feed>
  <link rel="self" href="https://example.com/feed.atom"/>
  <entry><link href="https://example.com/atom-1"/></entry>
  <entry><link href="https://example.com/atom-2"/></entry>
</feed>`;
    expect(parseRssUrls(xml)).toEqual(['https://example.com/atom-1', 'https://example.com/atom-2']);
  });

  it('dedupes URLs', () => {
    const xml = `<rss><channel>
      <item><link>https://example.com/x</link></item>
      <item><link>https://example.com/x</link></item>
    </channel></rss>`;
    expect(parseRssUrls(xml)).toEqual(['https://example.com/x']);
  });
});

describe('parseSitemapXml', () => {
  it('extracts URLs from sitemap', () => {
    const xml = `<urlset xmlns="http://sitemaps.org/...">
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(result.isIndex).toBe(false);
  });

  it('detects sitemap index', () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
    </sitemapindex>`;
    const result = parseSitemapXml(xml);
    expect(result.isIndex).toBe(true);
    expect(result.urls).toEqual(['https://example.com/sitemap-1.xml']);
  });
});
