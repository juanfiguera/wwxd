import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Suspense } from 'react';
import { loadCorpus } from '@/lib/persona';
import { getGroup, type Group } from '@/lib/groups';
import { Compare, type PersonaSummary } from './compare';

const EXCLUDED_FILES = new Set(['groups.json']);

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
      (f) => f.endsWith('.json') && !f.endsWith('.embeddings.json') && !EXCLUDED_FILES.has(f),
    )
    .map((f) => f.replace(/\.json$/, ''));

  const personas: PersonaSummary[] = [];
  for (const username of usernames) {
    try {
      const corpus = await loadCorpus(username);
      let hasEmbeddings = false;
      try {
        await stat(resolve(dir, `${username}.embeddings.json`));
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
      // skip malformed files
    }
  }
  return personas.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const [personas, params] = await Promise.all([listPersonas(), searchParams]);
  let currentGroup: Group | null = null;
  if (params.group) {
    currentGroup = await getGroup(params.group);
  }

  return (
    <Suspense fallback={null}>
      <Compare personas={personas} currentGroup={currentGroup} />
    </Suspense>
  );
}
