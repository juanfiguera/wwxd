import Link from 'next/link';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CSSProperties } from 'react';
import { getDb } from '@/lib/db';
import { loadCorpus } from '@/lib/persona';
import { personaStyle } from '@/lib/persona-styling';

type PersonaInfo = {
  username: string;
  displayName: string;
  mode: 'grounded' | 'prior-only';
};

async function listPersonas(): Promise<PersonaInfo[]> {
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
  const out: PersonaInfo[] = [];
  for (const username of usernames) {
    try {
      const corpus = await loadCorpus(username);
      out.push({
        username,
        displayName: corpus.displayName || username,
        mode: corpus.mode === 'prior-only' ? 'prior-only' : 'grounded',
      });
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

type PersonaRow = {
  username: string;
  displayName: string;
  isKnown: boolean;
  mode: 'grounded' | 'prior-only' | 'unknown';
  spoke: number;
  passed: number;
  errors: number;
  totalChars: number;
};

type OverallStats = {
  totalTurns: number;
  totalSpoke: number;
  totalPassed: number;
  totalErrored: number;
  totalChars: number;
};

type ConversationSpend = {
  id: string;
  title: string | null;
  participants: string[];
  totalChars: number;
  turns: number;
};

type RetrievalHealth = {
  username: string;
  displayName: string;
  totalCalls: number;
  callsWithHits: number;
  hitRate: number;
};

type DayBucket = {
  day: string;
  turns: number;
  spoke: number;
  passed: number;
  errored: number;
  totalChars: number;
};

function fetchByDay(days: number): DayBucket[] {
  const db = getDb();
  // Last `days` UTC days, oldest first. SQLite's date() coerces our
  // ISO8601 created_at strings to YYYY-MM-DD which is exactly the bucket
  // key we want.
  const rows = db
    .prepare(
      `SELECT date(created_at) AS day, kind, COUNT(*) AS n,
              COALESCE(SUM(CAST(json_extract(payload, '$.chars') AS INTEGER)), 0) AS chars
       FROM conversation_events
       WHERE kind IN ('persona.started', 'gate.spoke', 'gate.passed',
                      'persona.errored', 'persona.completed')
         AND date(created_at) >= date('now', '-' || ? || ' days')
       GROUP BY day, kind
       ORDER BY day ASC`,
    )
    .all(days - 1) as Array<{
    day: string;
    kind: string;
    n: number;
    chars: number;
  }>;
  const byDay = new Map<string, DayBucket>();
  for (const r of rows) {
    let b = byDay.get(r.day);
    if (!b) {
      b = {
        day: r.day,
        turns: 0,
        spoke: 0,
        passed: 0,
        errored: 0,
        totalChars: 0,
      };
      byDay.set(r.day, b);
    }
    if (r.kind === 'persona.started') b.turns = r.n;
    else if (r.kind === 'gate.spoke') b.spoke = r.n;
    else if (r.kind === 'gate.passed') b.passed = r.n;
    else if (r.kind === 'persona.errored') b.errored = r.n;
    else if (r.kind === 'persona.completed') b.totalChars = r.chars;
  }
  // Pad with empty buckets so the chart always shows the full window —
  // gives "no activity for 3 days" the visual weight it deserves.
  const out: DayBucket[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(
      byDay.get(key) ?? {
        day: key,
        turns: 0,
        spoke: 0,
        passed: 0,
        errored: 0,
        totalChars: 0,
      },
    );
  }
  return out;
}

function fetchOverall(): OverallStats {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT kind, COUNT(*) AS n,
              COALESCE(SUM(CAST(json_extract(payload, '$.chars') AS INTEGER)), 0) AS chars
       FROM conversation_events
       WHERE kind IN ('gate.spoke','gate.passed','persona.completed','persona.errored','persona.started')
       GROUP BY kind`,
    )
    .all() as Array<{ kind: string; n: number; chars: number }>;
  const m = new Map(counts.map((r) => [r.kind, r]));
  const completed = m.get('persona.completed');
  return {
    totalTurns: m.get('persona.started')?.n ?? 0,
    totalSpoke: m.get('gate.spoke')?.n ?? 0,
    totalPassed: m.get('gate.passed')?.n ?? 0,
    totalErrored: m.get('persona.errored')?.n ?? 0,
    totalChars: completed?.chars ?? 0,
  };
}

function fetchPersonaRows(personas: PersonaInfo[]): PersonaRow[] {
  const db = getDb();
  const speakRows = db
    .prepare(
      `SELECT speaker, kind, COUNT(*) AS n,
              COALESCE(SUM(CAST(json_extract(payload, '$.chars') AS INTEGER)), 0) AS chars
       FROM conversation_events
       WHERE speaker IS NOT NULL
         AND kind IN ('gate.spoke','gate.passed','persona.completed','persona.errored')
       GROUP BY speaker, kind`,
    )
    .all() as Array<{ speaker: string; kind: string; n: number; chars: number }>;

  const known = new Map(personas.map((p) => [p.username, p]));
  const byUser = new Map<string, PersonaRow>();
  function ensure(username: string): PersonaRow {
    let row = byUser.get(username);
    if (row) return row;
    const info = known.get(username);
    row = {
      username,
      displayName: info?.displayName ?? slugToFallbackName(username),
      isKnown: Boolean(info),
      mode: info?.mode ?? 'unknown',
      spoke: 0,
      passed: 0,
      errors: 0,
      totalChars: 0,
    };
    byUser.set(username, row);
    return row;
  }
  for (const r of speakRows) {
    const row = ensure(r.speaker);
    if (r.kind === 'gate.spoke') row.spoke = r.n;
    else if (r.kind === 'gate.passed') row.passed = r.n;
    else if (r.kind === 'persona.errored') row.errors = r.n;
    else if (r.kind === 'persona.completed') row.totalChars = r.chars;
  }
  // Solo turns don't fire gate.spoke (gate is roundtable-only) but they do
  // fire persona.completed. Treat each completion as one "spoke" so the
  // scorecard doesn't read 0/0 for solo-only personas.
  for (const row of byUser.values()) {
    if (row.spoke === 0 && row.totalChars > 0) {
      const completionsRow = db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversation_events
           WHERE speaker = ? AND kind = 'persona.completed'`,
        )
        .get(row.username) as { n: number };
      row.spoke = completionsRow.n;
    }
  }
  return [...byUser.values()].sort(
    (a, b) =>
      b.spoke + b.passed + b.errors - (a.spoke + a.passed + a.errors),
  );
}

function fetchTopConversations(limit: number): ConversationSpend[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.title,
              COALESCE(SUM(CAST(json_extract(e.payload, '$.chars') AS INTEGER)), 0) AS chars,
              SUM(CASE WHEN e.kind = 'persona.started' THEN 1 ELSE 0 END) AS turns
       FROM conversations c
       JOIN conversation_events e ON e.conversation_id = c.id
       GROUP BY c.id
       ORDER BY chars DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    title: string | null;
    chars: number;
    turns: number;
  }>;
  const participantsStmt = db.prepare(
    `SELECT persona_username FROM conversation_participants
     WHERE conversation_id = ? ORDER BY joined_at ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    participants: (
      participantsStmt.all(r.id) as Array<{ persona_username: string }>
    ).map((p) => p.persona_username),
    totalChars: r.chars,
    turns: r.turns,
  }));
}

function fetchRetrievalHealth(grounded: PersonaInfo[]): RetrievalHealth[] {
  const db = getDb();
  const groundedSet = new Set(grounded.map((p) => p.username));
  const rows = db
    .prepare(
      `SELECT speaker,
              COUNT(*) AS total,
              SUM(CASE WHEN CAST(json_extract(payload, '$.hits') AS INTEGER) > 0 THEN 1 ELSE 0 END) AS with_hits
       FROM conversation_events
       WHERE kind = 'retrieval' AND speaker IS NOT NULL
       GROUP BY speaker`,
    )
    .all() as Array<{ speaker: string; total: number; with_hits: number }>;
  const knownByUsername = new Map(grounded.map((p) => [p.username, p]));
  return rows
    .filter((r) => groundedSet.has(r.speaker))
    .map((r) => {
      const info = knownByUsername.get(r.speaker)!;
      return {
        username: info.username,
        displayName: info.displayName,
        totalCalls: r.total,
        callsWithHits: r.with_hits,
        hitRate: r.total === 0 ? 0 : r.with_hits / r.total,
      };
    })
    .sort((a, b) => a.hitRate - b.hitRate);
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

export default async function AggregatesPage() {
  const personas = await listPersonas();
  const overall = fetchOverall();
  const personaRows = fetchPersonaRows(personas);
  const topConvs = fetchTopConversations(10);
  const grounded = personas.filter((p) => p.mode === 'grounded');
  const retrieval = fetchRetrievalHealth(grounded);
  const byDay = fetchByDay(14);
  const maxDayTurns = byDay.reduce((m, b) => Math.max(m, b.turns), 0);

  const overallSpeakOrPass = overall.totalSpoke + overall.totalPassed;
  const overallPassRate =
    overallSpeakOrPass === 0 ? 0 : overall.totalPassed / overallSpeakOrPass;
  const avgCharsPerReply =
    overall.totalSpoke === 0 ? 0 : Math.round(overall.totalChars / overall.totalSpoke);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 md:px-6">
        <header className="mb-8">
          <Link
            href="/evals/conversations"
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            ← conversation traces
          </Link>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            Trace aggregates
          </h1>
          <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
            Engine behaviour across every conversation that has trace data.
            Numbers update on page load.
          </p>
        </header>

        {overall.totalTurns === 0 ? (
          <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-soft)]">
            No trace data yet. Open a chat, send a message, and come back — the
            engine writes events on every turn.
          </p>
        ) : (
          <>
            {/* Health summary */}
            <section className="mb-10">
              <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
                Health
              </h2>
              <p className="mb-3 text-xs text-[var(--ink-soft)]">
                A quick read on how the engine is behaving. Compare across
                sessions; values drifting in the wrong direction (more errors,
                pass rate spiking) usually point at a configuration issue.
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  label="Turns processed"
                  value={numberWithSep(overall.totalTurns)}
                  hint="one per persona reply attempt"
                />
                <StatCard
                  label="Gate pass rate"
                  value={pct(overallPassRate)}
                  hint={
                    overall.totalPassed +
                    ' passed of ' +
                    overallSpeakOrPass +
                    ' gated turns'
                  }
                />
                <StatCard
                  label="Avg chars / reply"
                  value={numberWithSep(avgCharsPerReply)}
                  hint="length of an average spoken reply"
                />
                <StatCard
                  label="Stream errors"
                  value={numberWithSep(overall.totalErrored)}
                  hint={overall.totalErrored === 0 ? 'clean' : 'check trace pages'}
                />
              </div>
            </section>

            {/* Time series — last 14 days */}
            <section className="mb-10">
              <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
                Last 14 days
              </h2>
              <p className="mb-3 text-xs text-[var(--ink-soft)]">
                Daily volume of persona turns. Bar height is total turns for the
                day; the green segment is gate-passed (didn&apos;t need to
                speak), red is errored. Watching this over a week tells you
                whether the engine&apos;s usage and error rate are healthy.
              </p>
              {byDay.length === 0 || maxDayTurns === 0 ? (
                <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-3 text-xs text-[var(--ink-soft)]">
                  No turns in the last 14 days.
                </p>
              ) : (
                <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]">
                  <div className="flex h-32 items-end gap-1">
                    {byDay.map((b) => {
                      const CHART_HEIGHT = 128;
                      const barH = Math.round((b.turns / maxDayTurns) * CHART_HEIGHT);
                      const erroredH =
                        b.turns === 0 ? 0 : Math.round((b.errored / b.turns) * barH);
                      const passedH =
                        b.turns === 0 ? 0 : Math.round((b.passed / b.turns) * barH);
                      return (
                        <div
                          key={b.day}
                          className="group/bar relative flex flex-1 items-end"
                          title={`${b.day} · ${b.turns} turn${b.turns === 1 ? '' : 's'} · ${b.passed} passed · ${b.errored} errored · ${numberWithSep(b.totalChars)} chars`}
                        >
                          <div
                            className="relative w-full rounded-t-sm bg-[var(--ink)] opacity-80 transition group-hover/bar:opacity-100"
                            style={{ height: `${barH}px` }}
                          >
                            {erroredH > 0 && (
                              <div
                                className="absolute inset-x-0 top-0 rounded-t-sm bg-red-600"
                                style={{ height: `${erroredH}px` }}
                              />
                            )}
                            {passedH > 0 && erroredH === 0 && (
                              <div
                                className="absolute inset-x-0 top-0 rounded-t-sm bg-amber-600"
                                style={{ height: `${passedH}px` }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] font-mono text-[var(--ink-faint)]">
                    <span>{byDay[0]?.day.slice(5)}</span>
                    <span>{byDay[byDay.length - 1]?.day.slice(5)}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Persona scorecard */}
            <section className="mb-10">
              <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
                Per persona
              </h2>
              <p className="mb-3 text-xs text-[var(--ink-soft)]">
                One row per persona that the engine has heard from. Pass rate
                is the share of roundtable turns where the gate decided they
                had nothing to add. A persona that passes more than ~50% of
                the time may not be earning their seat.
              </p>
              <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-left text-[11px] font-bold uppercase tracking-widest text-[var(--ink-soft)]">
                      <th className="px-3 py-2">Persona</th>
                      <th className="px-3 py-2 text-right">Spoke</th>
                      <th className="px-3 py-2 text-right">Passed</th>
                      <th className="px-3 py-2 text-right">Pass rate</th>
                      <th className="px-3 py-2 text-right">Avg chars</th>
                      <th className="px-3 py-2 text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personaRows.map((r) => {
                      const total = r.spoke + r.passed;
                      const passRate = total === 0 ? 0 : r.passed / total;
                      const avgChars =
                        r.spoke === 0 ? 0 : Math.round(r.totalChars / r.spoke);
                      const color = r.isKnown
                        ? personaStyle(r.username).color
                        : 'var(--ink-soft)';
                      const passRateTone =
                        passRate >= 0.5
                          ? '#b45309'
                          : passRate >= 0.25
                          ? '#a16207'
                          : 'var(--ink-soft)';
                      const personaHref = `/evals/personas/${encodeURIComponent(r.username)}`;
                      const linkStyle: CSSProperties = {
                        display: 'block',
                        textDecoration: 'none',
                        color: 'inherit',
                      };
                      return (
                        <tr
                          key={r.username}
                          className="border-b border-[var(--line)] last:border-b-0 transition hover:bg-[var(--paper-2)]"
                        >
                          <td className="px-3 py-2">
                            <Link href={personaHref} style={linkStyle}>
                              <div
                                className="font-display text-sm font-bold hover:underline"
                                style={{ color }}
                              >
                                {r.displayName}
                              </div>
                              <div className="text-[10.5px] text-[var(--ink-soft)]">
                                {r.isKnown ? r.mode : 'deleted'}
                              </div>
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            <Link href={personaHref} style={linkStyle}>
                              {r.spoke}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            <Link href={personaHref} style={linkStyle}>
                              {r.passed}
                            </Link>
                          </td>
                          <td
                            className="px-3 py-2 text-right font-mono text-sm"
                            style={{ color: passRateTone }}
                          >
                            <Link
                              href={personaHref}
                              style={{ ...linkStyle, color: passRateTone }}
                            >
                              {total === 0 ? '–' : pct(passRate)}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            <Link href={personaHref} style={linkStyle}>
                              {r.spoke === 0 ? '–' : numberWithSep(avgChars)}
                            </Link>
                          </td>
                          <td
                            className="px-3 py-2 text-right font-mono text-sm"
                            style={{
                              color: r.errors > 0 ? '#b91c1c' : 'var(--ink-soft)',
                            }}
                          >
                            <Link
                              href={personaHref}
                              style={{
                                ...linkStyle,
                                color: r.errors > 0 ? '#b91c1c' : 'var(--ink-soft)',
                              }}
                            >
                              {r.errors}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Top conversations by output */}
            <section className="mb-10">
              <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
                Heaviest conversations
              </h2>
              <p className="mb-3 text-xs text-[var(--ink-soft)]">
                Total characters the personas produced, summed across every
                turn. Closest cheap proxy for token spend — high-char
                conversations are typically the expensive ones. Click any row
                for the per-turn trace.
              </p>
              {topConvs.length === 0 ? (
                <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-3 text-xs text-[var(--ink-soft)]">
                  No completed turns yet.
                </p>
              ) : (
                <ol className="space-y-2">
                  {topConvs.map((c, i) => {
                    const personaLabels = c.participants
                      .map((u) => {
                        const known = personas.find((p) => p.username === u);
                        return known?.displayName ?? slugToFallbackName(u);
                      })
                      .join(', ');
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/evals/conversations/${c.id}`}
                          className="block rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-3 shadow-[var(--shadow-sm)] transition hover:border-[var(--ink)]"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-display text-sm font-bold text-[var(--ink)]">
                                <span className="mr-2 text-[var(--ink-faint)]">
                                  #{i + 1}
                                </span>
                                {c.title ?? personaLabels}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-[var(--ink-soft)]">
                                {c.turns} turn{c.turns === 1 ? '' : 's'} ·{' '}
                                {personaLabels}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono text-sm font-bold text-[var(--ink)]">
                                {numberWithSep(c.totalChars)}
                              </div>
                              <div className="text-[10.5px] text-[var(--ink-faint)]">
                                chars
                              </div>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {/* Retrieval health */}
            <section>
              <h2 className="mb-1 font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
                Retrieval health
              </h2>
              <p className="mb-3 text-xs text-[var(--ink-soft)]">
                For each grounded persona, what share of retrieval calls
                returned at least one hit. Anything below ~90% suggests the
                embedding index or the BM25 fallback isn&apos;t matching
                queries well — re-running ingestion usually fixes it.
                Prior-only personas are excluded; their retrieval is a no-op
                by design.
              </p>
              {retrieval.length === 0 ? (
                <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-3 text-xs text-[var(--ink-soft)]">
                  No retrieval events yet for grounded personas.
                </p>
              ) : (
                <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)] text-left text-[11px] font-bold uppercase tracking-widest text-[var(--ink-soft)]">
                        <th className="px-3 py-2">Persona</th>
                        <th className="px-3 py-2 text-right">Hit rate</th>
                        <th className="px-3 py-2 text-right">With hits</th>
                        <th className="px-3 py-2 text-right">Total calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retrieval.map((r) => {
                        const tone =
                          r.hitRate < 0.5
                            ? '#b91c1c'
                            : r.hitRate < 0.9
                            ? '#a16207'
                            : '#15803d';
                        return (
                          <tr
                            key={r.username}
                            className="border-b border-[var(--line)] last:border-b-0"
                          >
                            <td className="px-3 py-2">
                              <div
                                className="font-display text-sm font-bold"
                                style={{ color: personaStyle(r.username).color }}
                              >
                                {r.displayName}
                              </div>
                            </td>
                            <td
                              className="px-3 py-2 text-right font-mono text-sm font-bold"
                              style={{ color: tone }}
                            >
                              {pct(r.hitRate)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-sm">
                              {r.callsWithHits}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-sm">
                              {r.totalCalls}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
