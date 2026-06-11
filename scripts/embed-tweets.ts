import { embedTweets } from '../lib/embed';

async function main(): Promise<void> {
  const username = process.argv[2] ?? 'garrytan';

  await embedTweets(username, {}, (event) => {
    if (event.type === 'start') {
      console.log(
        `Embedding ${event.total} tweets for @${username} with ${event.model} (${event.dimensions} dims)...`,
      );
    } else if (event.type === 'batch') {
      console.log(`  ${event.done}/${event.total} embedded`);
    } else if (event.type === 'saved') {
      console.log(`Saved ${event.total} embeddings.`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
