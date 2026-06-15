import Link from 'next/link';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  countEventsByConversation,
  listConversations,
} from '@/lib/db';
import { loadCorpus } from '@/lib/persona';
import { RelativeTime } from '@/app/components/relative-time';
import { personaStyle } from '@/lib/persona-styling';

type PersonaLite = { username: string; displayName: string };

async function listPersonas(): Promise<PersonaLite[]> {
  const dir = process.env.WWXD_DATA_DIR ?? resolve(process.cwd(), 'data');
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
  const out: PersonaLite[] = [];
  for (const username of usernames) {
    try {
      const corpus = await loadCorpus(username);
      out.push({ username, displayName: corpus.displayName || username });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function slugToFallbackName(slug: string): string {
  if (!slug.includes('-') && !slug.includes('_')) return slug;
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

export default async function ConversationsIndexPage() {
  const [conversations, eventCounts, personas] = await Promise.all([
    Promise.resolve(listConversations({ limit: 200 })),
    Promise.resolve(countEventsByConversation()),
    listPersonas(),
  ]);
  const personaByUsername = new Map(personas.map((p) => [p.username, p]));
  const displayName = (username: string): string =>
    personaByUsername.get(username)?.displayName ?? slugToFallbackName(username);

  // Group so "has events" conversations come first — those are the ones
  // worth opening a trace for.
  const withEvents = conversations.filter((c) => (eventCounts.get(c.id) ?? 0) > 0);
  const withoutEvents = conversations.filter((c) => (eventCounts.get(c.id) ?? 0) === 0);

  function renderRow(c: (typeof conversations)[number]) {
    const events = eventCounts.get(c.id) ?? 0;
    const title =
      c.title ??
      (c.kind === 'solo'
        ? `Solo with ${displayName(c.participants[0] ?? '?')}`
        : `Roundtable: ${c.participants.map(displayName).join(', ')}`);
    const accent =
      c.participants.length > 0 ? personaStyle(c.participants[0]).color : undefined;
    return (
      <li key={c.id}>
        <Link
          href={`/evals/conversations/${c.id}`}
          className="block rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--ink)]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div
                className="truncate font-display text-base font-extrabold tracking-tight text-[var(--ink)]"
                style={accent ? { color: accent } : undefined}
              >
                {title}
              </div>
              <div className="mt-0.5 text-xs text-[var(--ink-soft)]">
                {c.kind} · {c.participants.length} persona
                {c.participants.length === 1 ? '' : 's'} · {c.messageCount} message
                {c.messageCount === 1 ? '' : 's'} ·{' '}
                <RelativeTime iso={c.updatedAt} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div
                className="font-display text-sm font-bold"
                style={{ color: events > 0 ? 'var(--ink)' : 'var(--ink-faint)' }}
              >
                {events} event{events === 1 ? '' : 's'}
              </div>
              <div className="text-[10.5px] text-[var(--ink-faint)]">trace →</div>
            </div>
          </div>
        </Link>
      </li>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <header className="mb-8">
          <Link
            href="/evals"
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            ← evals
          </Link>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            Conversation traces
          </h1>
          <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
            Every gate decision, retrieval hit, risk classification, and error
            from every roundtable turn. Open one to see why a persona did what
            they did.
          </p>
        </header>

        {conversations.length === 0 ? (
          <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-soft)]">
            No conversations yet.
          </p>
        ) : (
          <>
            {withEvents.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--ink-soft)]">
                  With trace data ({withEvents.length})
                </h2>
                <ul className="space-y-2">{withEvents.map(renderRow)}</ul>
              </section>
            )}
            {withoutEvents.length > 0 && (
              <section>
                <h2 className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--ink-soft)]">
                  Older — no trace data ({withoutEvents.length})
                </h2>
                <p className="mb-3 text-xs text-[var(--ink-soft)]">
                  Conversations from before Phase 1.3a wired the event log up.
                  Solo conversations also land here until the solo route is
                  swapped to pass <code className="font-mono">conversationId</code>.
                </p>
                <ul className="space-y-2">{withoutEvents.map(renderRow)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
