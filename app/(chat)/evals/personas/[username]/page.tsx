import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb } from '@/lib/db';
import { loadCorpus, type Corpus } from '@/lib/persona';
import { RelativeTime } from '@/app/components/relative-time';
import { personaStyle } from '@/lib/persona-styling';

type PersonaLite = { username: string; displayName: string };

async function listAllPersonas(): Promise<Map<string, PersonaLite>> {
  const dir = process.env.WWXD_DATA_DIR ?? resolve(process.cwd(), 'data');
  const out = new Map<string, PersonaLite>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  const usernames = entries
    .filter(
      (f) =>
        f.endsWith('.json') && !f.endsWith('.embeddings.json') && f !== 'groups.json',
    )
    .map((f) => f.replace(/\.json$/, ''));
  for (const username of usernames) {
    try {
      const c = await loadCorpus(username);
      out.set(username, { username, displayName: c.displayName || username });
    } catch {
      /* skip */
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

type PersonaSummaryStats = {
  totalTurns: number;
  spoke: number;
  passed: number;
  errors: number;
  totalChars: number;
  retrievalCalls: number;
  retrievalWithHits: number;
};

type ConversationSummary = {
  id: string;
  title: string | null;
  kind: 'solo' | 'roundtable';
  participants: string[];
  turnsByThisPersona: number;
  charsByThisPersona: number;
  lastSeenAt: string;
};

type RecentTurn = {
  conversationId: string;
  conversationTitle: string | null;
  ordinal: number;
  spoke: boolean;
  passed: boolean;
  passReason: string | null;
  errored: boolean;
  errorMessage: string | null;
  chars: number;
  retrievalHits: number | null;
  retrievalTopK: number | null;
  riskCategory: string | null;
  createdAt: string;
};

function fetchSummary(username: string): PersonaSummaryStats {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT kind, COUNT(*) AS n,
              COALESCE(SUM(CAST(json_extract(payload, '$.chars') AS INTEGER)), 0) AS chars,
              COALESCE(SUM(CASE WHEN CAST(json_extract(payload, '$.hits') AS INTEGER) > 0 THEN 1 ELSE 0 END), 0) AS with_hits
       FROM conversation_events
       WHERE speaker = ?
       GROUP BY kind`,
    )
    .all(username) as Array<{ kind: string; n: number; chars: number; with_hits: number }>;
  const m = new Map(rows.map((r) => [r.kind, r]));
  return {
    totalTurns: m.get('persona.started')?.n ?? 0,
    spoke: m.get('gate.spoke')?.n ?? (m.get('persona.completed')?.n ?? 0),
    passed: m.get('gate.passed')?.n ?? 0,
    errors: m.get('persona.errored')?.n ?? 0,
    totalChars: m.get('persona.completed')?.chars ?? 0,
    retrievalCalls: m.get('retrieval')?.n ?? 0,
    retrievalWithHits: m.get('retrieval')?.with_hits ?? 0,
  };
}

function fetchConversationSummaries(username: string): ConversationSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.kind,
              COUNT(DISTINCT CASE WHEN e.kind = 'persona.started' THEN e.id END) AS turns,
              COALESCE(SUM(CAST(json_extract(e.payload, '$.chars') AS INTEGER)), 0) AS chars,
              MAX(e.created_at) AS last_seen
       FROM conversation_events e
       JOIN conversations c ON c.id = e.conversation_id
       WHERE e.speaker = ?
       GROUP BY c.id
       ORDER BY last_seen DESC`,
    )
    .all(username) as Array<{
    id: string;
    title: string | null;
    kind: string;
    turns: number;
    chars: number;
    last_seen: string;
  }>;
  const partsStmt = db.prepare(
    `SELECT persona_username FROM conversation_participants
     WHERE conversation_id = ? ORDER BY joined_at ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind as 'solo' | 'roundtable',
    participants: (
      partsStmt.all(r.id) as Array<{ persona_username: string }>
    ).map((p) => p.persona_username),
    turnsByThisPersona: r.turns,
    charsByThisPersona: r.chars,
    lastSeenAt: r.last_seen,
  }));
}

function fetchRecentTurns(username: string, limit: number): RecentTurn[] {
  const db = getDb();
  // Pull every event for this speaker, group by (conversation_id, ordinal)
  // in memory. Caps at `limit` distinct turns by created_at desc.
  const events = db
    .prepare(
      `SELECT e.conversation_id, e.ordinal, e.kind, e.payload, e.created_at,
              c.title
       FROM conversation_events e
       JOIN conversations c ON c.id = e.conversation_id
       WHERE e.speaker = ?
       ORDER BY e.created_at DESC
       LIMIT 500`,
    )
    .all(username) as Array<{
    conversation_id: string;
    ordinal: number;
    kind: string;
    payload: string;
    created_at: string;
    title: string | null;
  }>;

  const turnMap = new Map<string, RecentTurn>();
  for (const ev of events) {
    const key = `${ev.conversation_id}:${ev.ordinal}`;
    let turn = turnMap.get(key);
    if (!turn) {
      turn = {
        conversationId: ev.conversation_id,
        conversationTitle: ev.title,
        ordinal: ev.ordinal,
        spoke: false,
        passed: false,
        passReason: null,
        errored: false,
        errorMessage: null,
        chars: 0,
        retrievalHits: null,
        retrievalTopK: null,
        riskCategory: null,
        createdAt: ev.created_at,
      };
      turnMap.set(key, turn);
    }
    const payload = JSON.parse(ev.payload) as Record<string, unknown> | null;
    if (ev.kind === 'gate.spoke') turn.spoke = true;
    else if (ev.kind === 'gate.passed') {
      turn.passed = true;
      turn.passReason = (payload?.reason as string) ?? null;
    } else if (ev.kind === 'persona.completed') {
      turn.spoke = turn.spoke || (payload?.chars as number) > 0;
      turn.chars = (payload?.chars as number) ?? 0;
    } else if (ev.kind === 'persona.errored') {
      turn.errored = true;
      turn.errorMessage = (payload?.message as string) ?? null;
    } else if (ev.kind === 'retrieval') {
      turn.retrievalHits = (payload?.hits as number) ?? 0;
      turn.retrievalTopK = (payload?.topK as number) ?? 0;
    } else if (ev.kind === 'risk.classified') {
      turn.riskCategory = (payload?.category as string) ?? null;
    }
  }
  return [...turnMap.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function numberWithSep(n: number): string {
  return n.toLocaleString();
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="text-[10.5px] font-bold uppercase tracking-widest text-[var(--ink-soft)]">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-[var(--ink-soft)]">{hint}</div>}
    </div>
  );
}

function Chip({
  label,
  color,
  title,
}: {
  label: string;
  color?: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
      style={{
        borderColor: color ?? 'var(--line)',
        color: color ?? 'var(--ink-soft)',
        background: 'white',
      }}
      title={title}
    >
      {label}
    </span>
  );
}

export default async function PersonaTracePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  let corpus: Corpus | null = null;
  try {
    corpus = await loadCorpus(username);
  } catch {
    /* persona may be deleted — that's OK, we can still render their event
       history without a corpus */
  }

  const summary = fetchSummary(username);
  // If the persona has no events AND no corpus, there's nothing to show.
  if (summary.totalTurns === 0 && !corpus) notFound();

  const [allPersonas, conversations, recentTurns] = await Promise.all([
    listAllPersonas(),
    Promise.resolve(fetchConversationSummaries(username)),
    Promise.resolve(fetchRecentTurns(username, 12)),
  ]);
  const resolveName = (slug: string): string =>
    allPersonas.get(slug)?.displayName ?? slugToFallbackName(slug);

  const displayName = corpus?.displayName ?? slugToFallbackName(username);
  const color = personaStyle(username).color;
  const gateGated = summary.spoke + summary.passed;
  const passRate = gateGated === 0 ? 0 : summary.passed / gateGated;
  const avgChars =
    summary.spoke === 0 ? 0 : Math.round(summary.totalChars / summary.spoke);
  const retrievalHitRate =
    summary.retrievalCalls === 0
      ? 0
      : summary.retrievalWithHits / summary.retrievalCalls;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 md:px-6">
        <header className="mb-6">
          <Link
            href="/evals/aggregates"
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            ← aggregates
          </Link>
          <h1
            className="mt-1 font-display text-2xl font-extrabold tracking-tight"
            style={{ color }}
          >
            {displayName}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
            {corpus ? (
              <>
                {corpus.mode === 'prior-only' ? 'Prior-only' : 'Grounded'}
                {corpus.tweets.length > 0 && (
                  <>
                    {' · '}
                    {numberWithSep(corpus.tweets.length)} corpus item
                    {corpus.tweets.length === 1 ? '' : 's'}
                  </>
                )}
                {corpus.fetchedAt && (
                  <>
                    {' · fetched '}
                    <RelativeTime iso={corpus.fetchedAt} />
                  </>
                )}
              </>
            ) : (
              <>Deleted — showing event history only</>
            )}
          </p>
        </header>

        {/* Summary stats */}
        <section className="mb-10">
          <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
            Track record
          </h2>
          <p className="mb-3 text-xs text-[var(--ink-soft)]">
            Aggregates for {displayName} across every conversation the engine
            has logged.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Turns"
              value={numberWithSep(summary.totalTurns)}
              hint="reply attempts"
            />
            <StatCard
              label="Pass rate"
              value={gateGated === 0 ? '–' : pct(passRate)}
              hint={
                gateGated === 0
                  ? 'never gated (solo or first speaker only)'
                  : `${summary.passed} of ${gateGated} gated turns`
              }
            />
            <StatCard
              label="Avg chars / reply"
              value={summary.spoke === 0 ? '–' : numberWithSep(avgChars)}
              hint={`over ${summary.spoke} spoken ${summary.spoke === 1 ? 'reply' : 'replies'}`}
            />
            <StatCard
              label="Retrieval hit rate"
              value={
                summary.retrievalCalls === 0 ? '–' : pct(retrievalHitRate)
              }
              hint={
                summary.retrievalCalls === 0
                  ? 'no retrieval calls'
                  : `${summary.retrievalWithHits} of ${summary.retrievalCalls} calls`
              }
            />
          </div>
        </section>

        {/* Recent turns timeline */}
        <section className="mb-10">
          <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
            Recent turns
          </h2>
          <p className="mb-3 text-xs text-[var(--ink-soft)]">
            Last {recentTurns.length} turn{recentTurns.length === 1 ? '' : 's'}, newest first. Each
            row links to the full trace for that conversation.
          </p>
          {recentTurns.length === 0 ? (
            <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-3 text-xs text-[var(--ink-soft)]">
              No turns yet.
            </p>
          ) : (
            <ol className="space-y-2">
              {recentTurns.map((t) => {
                const convLabel =
                  t.conversationTitle ??
                  `Conversation ${t.conversationId.slice(0, 8)}`;
                return (
                  <li key={`${t.conversationId}:${t.ordinal}`}>
                    <Link
                      href={`/evals/conversations/${t.conversationId}`}
                      className="block rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-3 shadow-[var(--shadow-sm)] transition hover:border-[var(--ink)]"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-display text-sm font-bold text-[var(--ink)]">
                            {convLabel}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                            ordinal #{t.ordinal} ·{' '}
                            <RelativeTime iso={t.createdAt} />
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          {t.retrievalHits !== null && (
                            <Chip
                              label={`retrieval ${t.retrievalHits}/${t.retrievalTopK ?? '?'}`}
                            />
                          )}
                          {t.riskCategory && (
                            <Chip
                              label={`risk: ${t.riskCategory}`}
                              color="#b45309"
                            />
                          )}
                          {t.passed && (
                            <Chip
                              label="PASSED"
                              color="#a16207"
                              title={t.passReason ?? undefined}
                            />
                          )}
                          {t.errored && (
                            <Chip
                              label="ERROR"
                              color="#b91c1c"
                              title={t.errorMessage ?? undefined}
                            />
                          )}
                          {t.spoke && !t.passed && !t.errored && (
                            <Chip
                              label={`${numberWithSep(t.chars)} chars`}
                              color="#15803d"
                            />
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Conversations participated in */}
        <section>
          <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
            Conversations
          </h2>
          <p className="mb-3 text-xs text-[var(--ink-soft)]">
            Every conversation {displayName} has been part of, sorted by most
            recent activity.
          </p>
          {conversations.length === 0 ? (
            <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-3 text-xs text-[var(--ink-soft)]">
              None yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {conversations.map((c) => {
                const label =
                  c.title ??
                  (c.kind === 'solo'
                    ? `Solo with ${displayName}`
                    : `Roundtable: ${c.participants.map(resolveName).join(', ')}`);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/evals/conversations/${c.id}`}
                      className="block rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-3 shadow-[var(--shadow-sm)] transition hover:border-[var(--ink)]"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-display text-sm font-bold text-[var(--ink)]">
                            {label}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                            {c.kind} · {c.turnsByThisPersona} turn
                            {c.turnsByThisPersona === 1 ? '' : 's'} ·{' '}
                            {numberWithSep(c.charsByThisPersona)} chars ·{' '}
                            <RelativeTime iso={c.lastSeenAt} />
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
