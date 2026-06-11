import { fetchTweets } from '../lib/fetch';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const deep = args.includes('--deep');
  const fileFlagIdx = args.indexOf('--file');
  const filePath = fileFlagIdx >= 0 ? args[fileFlagIdx + 1] : undefined;
  const positional = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      !(fileFlagIdx >= 0 && i === fileFlagIdx + 1),
  );
  const username = positional[0] ?? 'garrytan';
  const maxItems = Number(positional[1] ?? '3000');

  // Passing --file or setting TWEET_PROVIDER=file routes through the file
  // ingester instead of Apify. Lets you import an X archive export or any
  // JSON dump without spending Apify credits.
  if (filePath && !process.env.TWEET_PROVIDER) {
    process.env.TWEET_PROVIDER = 'file';
  }

  await fetchTweets(username, { deep, maxItems, filePath }, (event) => {
    if (event.type === 'start') {
      console.log(`Fetching @${event.username} (${event.deep ? 'deep' : 'latest'})...`);
    } else if (event.type === 'window') {
      if (event.start && event.end) console.log(`  Window ${event.start} → ${event.end}...`);
      else console.log('  Fetching...');
    } else if (event.type === 'window-done') {
      console.log(`    +${event.added} new (corpus now ${event.total}, ${event.originals} originals)`);
    } else if (event.type === 'window-error') {
      console.warn(`    window failed: ${event.message}`);
    } else if (event.type === 'saved') {
      console.log(`Saved ${event.total} tweets (${event.originals} originals) for ${event.displayName}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
