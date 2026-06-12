import { notFound } from 'next/navigation';
import { loadCorpus } from '@/lib/persona';
import { Chat } from './chat';

type PageProps = { params: Promise<{ username: string }> };

export default async function PersonaPage({ params }: PageProps) {
  const { username } = await params;

  let corpus;
  try {
    corpus = await loadCorpus(username);
  } catch {
    notFound();
  }

  return (
    <Chat
      username={username}
      displayName={corpus.displayName || username}
      tweetCount={corpus.tweets.length}
      fetchedAt={corpus.fetchedAt}
      mode={corpus.mode}
    />
  );
}
