import { createHash } from 'node:crypto';
import { saveCorpus, startCorpusMerge } from './corpus-io';
import type {
  EssayIngester,
  EssayProgress,
  EssayResult,
  Tweet,
} from './types';

function essayIdFromUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) return decodeEntities(title[1]).trim();
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return decodeEntities(h1[1]).trim();
  return 'Untitled';
}

export function extractMainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const article = s.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article) s = article[1];
  else {
    const main = s.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (main) s = main[1];
    else {
      const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (body) s = body[1];
    }
  }

  s = s.replace(/<\/?(?:p|br|div|h\d|li|blockquote)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

async function fetchEssay(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'wwxd/1.0 (essay ingestor)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return { title: extractTitle(html), text: extractMainText(html) };
}

export const essayHttpIngester: EssayIngester = async function essayHttpIngester(
  username: string,
  urls: string[],
  onProgress: (event: EssayProgress) => void,
): Promise<EssayResult> {
  const { outPath, byId, initialDisplayName } = await startCorpusMerge(username);
  const displayName = initialDisplayName;
  onProgress({ type: 'start', total: urls.length });

  let added = 0;
  for (const url of urls) {
    try {
      const { title, text } = await fetchEssay(url);
      if (text.length < 200) {
        onProgress({ type: 'failed', url, message: `extracted only ${text.length} chars` });
        continue;
      }
      const id = essayIdFromUrl(url);
      const item: Tweet = {
        id,
        url,
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
        source: 'essay',
      };
      if (!byId.has(id)) added += 1;
      byId.set(id, item);
      onProgress({ type: 'fetched', url, title, chars: text.length });
    } catch (err) {
      onProgress({
        type: 'failed',
        url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { total } = await saveCorpus(outPath, username, displayName, byId);
  onProgress({ type: 'saved', total });
  return { added, total };
};

// Re-export discovery helpers used by the CLI — they're provider-agnostic
// inasmuch as they're standard RSS/sitemap fetchers anyone can call.
export async function discoverRssUrls(rssUrl: string): Promise<string[]> {
  const res = await fetch(rssUrl, {
    headers: { 'User-Agent': 'wwxd/1.0 (essay discovery)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching RSS feed`);
  return parseRssUrls(await res.text());
}

export async function discoverSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const res = await fetch(sitemapUrl, {
    headers: { 'User-Agent': 'wwxd/1.0 (essay discovery)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching sitemap`);
  const { urls, isIndex } = parseSitemapXml(await res.text());
  if (!isIndex) return urls;
  const nested = await Promise.all(urls.map((u) => discoverSitemapUrls(u, depth + 1)));
  return nested.flat();
}

export function parseRssUrls(xml: string): string[] {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g) ?? [];
  const urls: string[] = [];
  for (const block of itemBlocks) {
    const rssMatch = block.match(/<link>([^<]+)<\/link>/);
    if (rssMatch && rssMatch[1].trim().startsWith('http')) {
      urls.push(rssMatch[1].trim());
      continue;
    }
    const atomMatch = block.match(/<link[^>]*href=["']([^"']+)["']/);
    if (atomMatch && atomMatch[1].trim().startsWith('http')) {
      urls.push(atomMatch[1].trim());
    }
  }
  return Array.from(new Set(urls));
}

export function parseSitemapXml(xml: string): { urls: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex/i.test(xml);
  const urls: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1].trim());
  }
  return { urls: Array.from(new Set(urls)), isIndex };
}
