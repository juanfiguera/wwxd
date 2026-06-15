import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  getConversation,
  getParticipants,
  loadEvents,
  loadMessages,
  type ConversationEvent,
  type StoredMessage,
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

type EventGroup = {
  /** The user message ordinal that triggered this turn (or -1 if none found). */
  triggerOrdinal: number;
  userMessage: StoredMessage | null;
  /** Per-speaker, in the order they appeared. */
  bySpeaker: Map<string, { speakerOrdinal: number; events: ConversationEvent[] }>;
  speakerOrder: string[];
};

/**
 * Group events by the user-message TURN they belong to. For each event with
 * ordinal N, walk backwards through the messages to find the nearest user
 * message at or before N — that's the question that triggered this turn.
 * Events sharing that trigger get grouped together.
 *
 * Caller index (0-based) is treated as the canonical message ordinal because
 * messages are stored contiguously by saveMessages.
 */
function groupEventsByTurn(
  events: ConversationEvent[],
  messages: StoredMessage[],
): EventGroup[] {
  function findTriggerOrdinal(ordinal: number): {
    triggerOrdinal: number;
    userMessage: StoredMessage | null;
  } {
    // ev.ordinal is the 1-indexed position of the assistant message being
    // produced for this event. Walk back from ONE BEFORE that position so
    // the new assistant itself doesn't shadow the user that triggered it
    // (which would happen if we started at ordinal and the trace renders
    // after a later turn appended more rows).
    const upper = Math.min(ordinal - 1, messages.length - 1);
    for (let i = upper; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === 'user') {
        return { triggerOrdinal: i, userMessage: m };
      }
    }
    return { triggerOrdinal: -1, userMessage: null };
  }

  const byTrigger = new Map<number, EventGroup>();
  for (const ev of events) {
    const { triggerOrdinal, userMessage } = findTriggerOrdinal(ev.ordinal);
    let g = byTrigger.get(triggerOrdinal);
    if (!g) {
      g = {
        triggerOrdinal,
        userMessage,
        bySpeaker: new Map(),
        speakerOrder: [],
      };
      byTrigger.set(triggerOrdinal, g);
    }
    const speaker = ev.speaker ?? '_system';
    let bucket = g.bySpeaker.get(speaker);
    if (!bucket) {
      bucket = { speakerOrdinal: ev.ordinal, events: [] };
      g.bySpeaker.set(speaker, bucket);
      g.speakerOrder.push(speaker);
    }
    bucket.events.push(ev);
  }
  // Sort turns by trigger ordinal ascending; within a turn, sort speakers by
  // the ordinal they spoke at (round-robin order).
  for (const g of byTrigger.values()) {
    g.speakerOrder.sort(
      (a, b) =>
        (g.bySpeaker.get(a)?.speakerOrdinal ?? 0) -
        (g.bySpeaker.get(b)?.speakerOrdinal ?? 0),
    );
  }
  return [...byTrigger.values()].sort(
    (a, b) => a.triggerOrdinal - b.triggerOrdinal,
  );
}

function EventChip({
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

function renderEvent(ev: ConversationEvent): React.ReactNode {
  const payload = ev.payload as Record<string, unknown> | null;
  switch (ev.kind) {
    case 'persona.started':
      return <EventChip key={ev.id} label="started" />;
    case 'retrieval': {
      const hits = (payload?.hits as number) ?? 0;
      const topK = (payload?.topK as number) ?? 0;
      return (
        <EventChip
          key={ev.id}
          label={`retrieval ${hits}/${topK}`}
          title={
            Array.isArray(payload?.tweetIds)
              ? `cited ids:\n${(payload!.tweetIds as string[]).join('\n')}`
              : undefined
          }
        />
      );
    }
    case 'risk.classified': {
      const cat = payload?.category as string | null;
      return (
        <EventChip
          key={ev.id}
          label={cat ? `risk: ${cat}` : 'risk: none'}
          color={cat ? '#b45309' : undefined}
        />
      );
    }
    case 'gate.spoke':
      return <EventChip key={ev.id} label="gate: spoke" color="#15803d" />;
    case 'gate.passed':
      return (
        <EventChip
          key={ev.id}
          label="gate: PASSED"
          color="#a16207"
          title={(payload?.reason as string) ?? undefined}
        />
      );
    case 'persona.completed': {
      const chars = (payload?.chars as number) ?? 0;
      return (
        <EventChip
          key={ev.id}
          label={`completed · ${chars} chars`}
          color="#15803d"
        />
      );
    }
    case 'persona.errored': {
      const msg = (payload?.message as string) ?? '';
      const code = (payload?.code as string) ?? 'error';
      return (
        <EventChip
          key={ev.id}
          label={`ERROR · ${code}`}
          color="#b91c1c"
          title={msg}
        />
      );
    }
    default:
      return <EventChip key={ev.id} label={ev.kind} />;
  }
}

export default async function ConversationTracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) notFound();
  const [events, messages, participants, personas] = await Promise.all([
    Promise.resolve(loadEvents(id)),
    Promise.resolve(loadMessages(id)),
    Promise.resolve(getParticipants(id)),
    listPersonas(),
  ]);
  const groups = groupEventsByTurn(events, messages);
  const personaByUsername = new Map(personas.map((p) => [p.username, p]));
  // Fallback for personas that have since been deleted — turn the slug into
  // a presentable name so the trace still reads cleanly. "marcus-aurelius"
  // becomes "Marcus Aurelius"; "paulg" stays "paulg" (no separators to split
  // on, no signal that title-casing would help).
  const slugToFallbackName = (slug: string): string => {
    if (!slug.includes('-') && !slug.includes('_')) return slug;
    return slug
      .split(/[-_]/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join(' ');
  };
  const displayName = (username: string): string =>
    personaByUsername.get(username)?.displayName ?? slugToFallbackName(username);

  const backUrl =
    conv.kind === 'solo'
      ? `/${participants[0] ?? ''}`
      : `/compare?personas=${participants.join(',')}&mode=roundtable&conversation=${id}`;
  const title =
    conv.title ??
    (conv.kind === 'solo'
      ? `Solo with ${displayName(participants[0] ?? '')}`
      : `Roundtable: ${participants.map(displayName).join(', ')}`);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <header className="mb-6">
          <Link
            href={backUrl}
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            ← back to chat
          </Link>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            Trace · {title}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {participants.length} persona{participants.length === 1 ? '' : 's'} ·{' '}
            {messages.length} message{messages.length === 1 ? '' : 's'} ·{' '}
            {events.length} event{events.length === 1 ? '' : 's'} ·{' '}
            <RelativeTime iso={conv.updatedAt} />
          </p>
        </header>

        {groups.length === 0 ? (
          <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-soft)]">
            No events captured yet. Events start landing here the next time you
            send a roundtable message. Solo chats don&apos;t emit events yet —
            that&apos;s a separate follow-up.
          </p>
        ) : (
          <ol className="space-y-5">
            {groups.map((g) => (
              <li
                key={g.triggerOrdinal}
                className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="mb-3 flex items-baseline gap-2 text-xs text-[var(--ink-soft)]">
                  <span className="font-mono shrink-0">
                    turn {g.triggerOrdinal >= 0 ? `#${g.triggerOrdinal}` : '?'}
                  </span>
                  {g.userMessage ? (
                    <span className="italic text-[var(--ink-2)] line-clamp-2">
                      &ldquo;{g.userMessage.text}&rdquo;
                    </span>
                  ) : (
                    <span className="italic">(no user message found at this ordinal)</span>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {g.speakerOrder.map((speaker) => {
                    const evs = g.bySpeaker.get(speaker)!.events;
                    const color =
                      speaker === '_system' ? undefined : personaStyle(speaker).color;
                    const label =
                      speaker === '_system' ? 'system' : displayName(speaker);
                    return (
                      <li
                        key={speaker}
                        className="flex items-center gap-2 flex-wrap"
                      >
                        <span
                          className="min-w-[120px] shrink-0 font-display text-xs font-bold"
                          style={{ color: color ?? 'var(--ink-soft)' }}
                        >
                          {label}
                        </span>
                        {evs.map(renderEvent)}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
