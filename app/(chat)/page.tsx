import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Suspense } from 'react';
import { loadCorpus } from '@/lib/persona';
import { listGroups } from '@/lib/groups';
import { listConversations } from '@/lib/db';
import { AddPersona } from '@/app/components/add-persona';
import { EmptyHome } from '@/app/components/empty-home';
import { GroupsSection } from '@/app/components/groups-section';
import { PersonaList, type PersonaSummary } from '@/app/components/persona-list';
import {
  ConversationsSection,
  type RecentConversation,
} from '@/app/components/conversations-section';

async function listPersonas(): Promise<PersonaSummary[]> {
  const dir = resolve(process.cwd(), 'data');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const usernames = entries
    .filter(
      (f) =>
        f.endsWith('.json') && !f.endsWith('.embeddings.json') && f !== 'groups.json',
    )
    .map((f) => f.replace(/\.json$/, ''));

  const personas: PersonaSummary[] = [];
  for (const username of usernames) {
    try {
      const corpus = await loadCorpus(username);
      const embeddingsFile = resolve(dir, `${username}.embeddings.json`);
      let hasEmbeddings = false;
      try {
        await stat(embeddingsFile);
        hasEmbeddings = true;
      } catch {
        hasEmbeddings = false;
      }
      personas.push({
        username,
        displayName: corpus.displayName || username,
        tweetCount: corpus.tweets.length,
        fetchedAt: corpus.fetchedAt,
        hasEmbeddings,
        mode: corpus.mode,
      });
    } catch {
      // skip malformed corpus files
    }
  }

  return personas.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function enrichConversation(
  conv: { kind: 'solo' | 'roundtable'; key: string; updatedAt: string; messageCount: number },
  personas: PersonaSummary[],
): RecentConversation {
  const usernames = conv.kind === 'solo' ? [conv.key] : conv.key.split(',');
  const participants = usernames.map((u) => ({
    username: u,
    displayName: personas.find((p) => p.username === u)?.displayName ?? u,
  }));
  return {
    kind: conv.kind,
    key: conv.key,
    updatedAt: conv.updatedAt,
    messageCount: conv.messageCount,
    participants,
  };
}

export default async function HomePage() {
  const [personas, groups] = await Promise.all([listPersonas(), listGroups()]);
  const conversations = listConversations()
    .filter((c) => c.messageCount > 0)
    .map((c) => enrichConversation(c, personas));

  const isFirstRun = personas.length === 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <header className="mb-8">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            {isFirstRun ? 'Start here' : 'Your personas'}
          </h1>
          {!isFirstRun && (
            <p className="mt-1 text-sm text-[var(--ink-soft)] leading-relaxed">
              Click a card to talk solo, or tap{' '}
              <span className="rounded-full border border-[var(--line)] bg-white px-2 py-0.5 font-display text-[11px] font-bold text-[var(--ink)]">
                + group
              </span>{' '}
              on each to compare perspectives.
            </p>
          )}
        </header>

        {isFirstRun ? (
          <>
            <div className="mb-8">
              <EmptyHome />
            </div>
            <div className="mb-8">
              <AddPersona />
            </div>
          </>
        ) : (
          <>
            <div className="mb-8">
              <AddPersona />
            </div>

            <ConversationsSection conversations={conversations} />

            <GroupsSection groups={groups} personas={personas} />

            <Suspense fallback={null}>
              <PersonaList personas={personas} />
            </Suspense>
          </>
        )}
      </div>
    </div>
  );
}
