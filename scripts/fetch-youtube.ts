import { fetchYouTubeTranscripts } from '../lib/fetch-youtube';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: pnpm fetch-youtube <username> <video-url-or-id> [more] ...');
    process.exit(1);
  }
  const username = args[0];
  const videoInputs = args.slice(1);

  // If the user passed a .json file (or set YOUTUBE_PROVIDER=file), route
  // through the file ingester instead of scraping youtube.com.
  const looksLikeManifest = videoInputs.some((v) => v.toLowerCase().endsWith('.json'));
  if (looksLikeManifest && !process.env.YOUTUBE_PROVIDER) {
    process.env.YOUTUBE_PROVIDER = 'file';
  }

  console.log(`Fetching ${videoInputs.length} YouTube transcript(s) for @${username}...`);

  const result = await fetchYouTubeTranscripts(username, videoInputs, (event) => {
    if (event.type === 'start') console.log(`  ${event.total} video(s) queued`);
    else if (event.type === 'fetched')
      console.log(`  ✓ ${event.videoId} — "${event.title}" (${event.chars} chars)`);
    else if (event.type === 'failed') console.log(`  ✗ ${event.videoId} — ${event.message}`);
    else if (event.type === 'saved')
      console.log(`  saved (corpus now ${event.total} items)`);
  });

  console.log(`\nAdded ${result.added} new transcript(s). Corpus: ${result.total} items.`);
  console.log(`Next: pnpm embed-tweets ${username}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
