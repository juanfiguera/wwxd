import { readFile } from 'node:fs/promises';
import {
  discoverRssUrls,
  discoverSitemapUrls,
  fetchEssays,
} from '../lib/fetch-essays';

async function loadUrlsFromFile(path: string): Promise<string[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

function usage(): never {
  console.error('Usage:');
  console.error('  pnpm fetch-essays <username> <url1> [url2] ...');
  console.error('  pnpm fetch-essays <username> --file urls.txt');
  console.error('  pnpm fetch-essays <username> --rss https://example.com/feed.xml');
  console.error('  pnpm fetch-essays <username> --sitemap https://example.com/sitemap.xml');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  const username = args[0];
  const rest = args.slice(1);
  let urls: string[];

  if (rest[0] === '--file' && rest[1]) {
    urls = await loadUrlsFromFile(rest[1]);
  } else if (rest[0] === '--rss' && rest[1]) {
    console.log(`Reading RSS: ${rest[1]}`);
    urls = await discoverRssUrls(rest[1]);
    console.log(`  found ${urls.length} entries`);
  } else if (rest[0] === '--sitemap' && rest[1]) {
    console.log(`Reading sitemap: ${rest[1]}`);
    urls = await discoverSitemapUrls(rest[1]);
    console.log(`  found ${urls.length} URLs`);
  } else {
    urls = rest;
  }

  // If the user passed a .json file (or set ESSAY_PROVIDER=file), route
  // through the file ingester instead of HTTP scraping.
  const looksLikeManifest = urls.some((u) => u.toLowerCase().endsWith('.json'));
  if (looksLikeManifest && !process.env.ESSAY_PROVIDER) {
    process.env.ESSAY_PROVIDER = 'file';
  }

  if (urls.length === 0 && !process.env.ESSAY_FILE_PATH && process.env.ESSAY_PROVIDER !== 'file') {
    console.error('No URLs to fetch.');
    process.exit(1);
  }

  console.log(`Fetching ${urls.length} essay(s) for @${username}...`);
  const result = await fetchEssays(username, urls, (event) => {
    if (event.type === 'start') console.log(`  ${event.total} URL(s) queued`);
    else if (event.type === 'fetched')
      console.log(`  ✓ ${event.url}\n    "${event.title}" — ${event.chars} chars`);
    else if (event.type === 'failed') console.log(`  ✗ ${event.url} — ${event.message}`);
    else if (event.type === 'saved')
      console.log(`  saved (corpus now ${event.total} items)`);
  });

  console.log(`\nAdded ${result.added} new essay(s). Corpus: ${result.total} items.`);
  console.log(`Next: pnpm embed-tweets ${username}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
