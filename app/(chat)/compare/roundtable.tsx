'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useSWR from 'swr';
import { AIBadge } from '@/app/components/ai-badge';
import { ImpressionCard } from '@/app/components/impression-card';
import { PersonaAvatar } from '@/app/components/persona-avatar';
import { ShareButton } from '@/app/components/share-button';
import { useStickyScroll } from '@/app/components/use-sticky-scroll';
import {
  conversationFetcher,
  conversationMessagesUrl,
  roundtableKey as roundtableSWRKey,
  type Conversation,
  type StoredMessageWire,
} from '@/app/components/conversation-cache';
import { fetchJson } from '@/app/components/fetch-utils';
import {
  SourcesPanel,
  extractCitedIds,
  renderCitationMarkers,
  type RetrievedTweetMeta,
} from '@/app/components/sources-panel';
import { personaStyle, tintHex } from '@/lib/persona-styling';
import type { PersonaSummary } from './compare';


export type RoundtableMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  speaker?: string;
  retrievedTweets?: RetrievedTweetMeta[];
  passed?: boolean;
  passReason?: string;
};

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function rtToStored(m: RoundtableMessage): StoredMessageWire {
  const meta: Record<string, unknown> = {};
  if (m.retrievedTweets) meta.retrievedTweets = m.retrievedTweets;
  if (m.passed) {
    meta.passed = true;
    meta.passReason = m.passReason;
  }
  return {
    id: m.id,
    role: m.role,
    speaker: m.speaker ?? null,
    text: m.text,
    metadata: Object.keys(meta).length > 0 ? meta : null,
  };
}

function storedToRt(s: StoredMessageWire): RoundtableMessage {
  const meta = (s.metadata ?? {}) as {
    retrievedTweets?: RetrievedTweetMeta[];
    passed?: boolean;
    passReason?: string;
  };
  return {
    id: s.id,
    role: s.role,
    text: s.text,
    speaker: s.speaker ?? undefined,
    retrievedTweets: meta.retrievedTweets,
    passed: meta.passed,
    passReason: meta.passReason,
  };
}

export function RoundtableView({
  personas,
  pendingSubmission,
  onConsumeSubmission,
  groupName,
  conversationId,
  onConversationCreated,
}: {
  personas: PersonaSummary[];
  pendingSubmission: { id: number; text: string } | null;
  onConsumeSubmission: () => void;
  /** Optional saved-group name. Used as the share title when present. */
  groupName?: string;
  /**
   * The conversation's stable UUID. Null in "compose mode" — we render
   * locally and create the conversation on first save. Parent should react
   * via onConversationCreated to update the URL.
   */
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<RoundtableMessage[]>([]);
  const [streamingFor, setStreamingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ref: scrollRef, pinned, scrollToBottom, ping } = useStickyScroll<HTMLDivElement>();
  const lastFiredId = useRef<number | null>(null);
  const hydratedConvId = useRef<string | null>(null);
  const messagesRef = useRef<RoundtableMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const usernames = useMemo(() => personas.map((p) => p.username), [personas]);

  // SWR is keyed on the conversation UUID. In compose mode (conversationId
  // null) we pass `null` so SWR doesn't fire — local state is the source of
  // truth until the first save creates the conversation.
  const swrKey = conversationId ? roundtableSWRKey(conversationId) : null;
  const { data, mutate } = useSWR(swrKey, conversationFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // Hydrate once per conversation. With UUID-based identity there's no
  // "key changed because participants changed" case to handle — adding a
  // participant updates conversation_participants without forking.
  useEffect(() => {
    if (!conversationId) return;
    if (!data) return; // still loading
    if (hydratedConvId.current === conversationId) return;
    hydratedConvId.current = conversationId;
    setMessages(data.messages.map(storedToRt));
  }, [data, conversationId]);

  // Reset hydration if the conversation id is removed (e.g. user navigates
  // back to compose mode in the same component instance).
  useEffect(() => {
    if (!conversationId) hydratedConvId.current = null;
  }, [conversationId]);

  // Explicit save. If the conversation hasn't been created yet, this also
  // creates it (POST /api/conversations) and notifies the parent so the URL
  // can pick up the new id.
  const save = useCallback(
    async (msgs: RoundtableMessage[]) => {
      // Clear the (existing) conversation
      if (msgs.length === 0 && conversationId) {
        mutate(
          (prev) => (prev ? { ...prev, messages: [] } : prev),
          { revalidate: false },
        );
        fetchJson(conversationMessagesUrl(conversationId), {
          method: 'DELETE',
          onErrorMessage: "Couldn't clear this roundtable on the server.",
        })
          .then(() => router.refresh())
          .catch(() => {});
        return;
      }
      if (msgs.length === 0) return; // nothing to save and nothing to clear

      const wire = msgs.map(rtToStored);

      // Lazy create on first save
      let id = conversationId;
      if (!id) {
        try {
          const createRes = await fetchJson<{ conversation: Conversation }>(
            '/api/conversations',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'roundtable',
                participants: usernames,
                ...(groupName ? { title: groupName } : {}),
              }),
              onErrorMessage:
                "Couldn't save this roundtable. Replies are visible but won't survive a reload.",
            },
          );
          id = createRes.conversation.id;
          onConversationCreated(id);
        } catch {
          return; // toast already fired
        }
      }

      const messagesUrl = conversationMessagesUrl(id);
      const optimistic = {
        conversation: { id, kind: 'roundtable' as const, title: groupName ?? null, createdAt: '', updatedAt: '' },
        participants: usernames,
        messages: wire,
      };
      mutate(optimistic, { revalidate: false });
      fetchJson(messagesUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire }),
        onErrorMessage:
          "Couldn't save this roundtable. Replies are visible but won't survive a reload.",
      })
        .then(() => router.refresh())
        .catch(() => {});
    },
    [conversationId, usernames, groupName, mutate, router, onConversationCreated],
  );

  // Scroll on update — only if user is already near the bottom
  useEffect(() => {
    ping();
  }, [messages, streamingFor, ping]);

  const runRoundRobin = useCallback(
    async (userText: string) => {
      setError(null);
      const userMsg: RoundtableMessage = { id: uid(), role: 'user', text: userText };

      // Use a ref so `working` is reliable even when React batches/reorders updates.
      // The previous pattern (mutating `working` inside a setMessages callback) could
      // race: setMessages updaters fire later than the next sync line, so the closure
      // assignment was unreliable.
      const startingMessages = messagesRef.current;
      let working: RoundtableMessage[] = [...startingMessages, userMsg];
      setMessages(working);
      // Persist immediately so the rail's Recent picks up the new conversation
      // the moment the user hits send — they shouldn't have to wait through 4
      // persona responses to see the row appear.
      save(working);

      const speakerMeta = personas.map((p) => ({ username: p.username, displayName: p.displayName }));

      for (const persona of personas) {
        const placeholder: RoundtableMessage = {
          id: uid(),
          role: 'assistant',
          text: '',
          speaker: persona.username,
        };
        working = [...working, placeholder];
        setMessages([...working]);
        setStreamingFor(persona.username);

        try {
          const res = await fetch('/api/roundtable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              speaker: persona.username,
              speakers: speakerMeta,
              history: working
                .slice(0, -1)
                .map((m) => ({ role: m.role, text: m.text, speaker: m.speaker })),
            }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            console.error(`[roundtable] @${persona.username} HTTP ${res.status}`, body);
            working = working.map((m) =>
              m.id === placeholder.id
                ? {
                    ...m,
                    passed: true,
                    passReason: `(error: ${body.error ?? res.statusText})`,
                  }
                : m,
            );
            setMessages([...working]);
            continue;
          }

          // Parse retrieved tweets from response header (if present)
          let retrieved: RetrievedTweetMeta[] = [];
          const headerVal = res.headers.get('X-Retrieved-Tweets');
          if (headerVal) {
            try {
              retrieved = JSON.parse(decodeURIComponent(headerVal)) as RetrievedTweetMeta[];
            } catch {
              // ignore malformed header
            }
          }

          // The route returns one of two shapes:
          //   - JSON: { passed: true, reason } when the gate decided to skip
          //   - text stream: when the persona actually responds
          // Branch up-front so we never try to read the body twice.
          const contentType = res.headers.get('Content-Type') ?? '';
          const isJsonBody = contentType.includes('application/json');

          if (isJsonBody) {
            const body = await res
              .json()
              .catch(() => null as { passed?: boolean; reason?: string } | null);
            if (body && body.passed) {
              working = working.map((m) =>
                m.id === placeholder.id
                  ? {
                      ...m,
                      passed: true,
                      passReason: body.reason ?? 'no comment',
                      retrievedTweets: retrieved,
                    }
                  : m,
              );
            } else {
              // Unexpected JSON shape — surface it instead of silently dropping
              working = working.map((m) =>
                m.id === placeholder.id
                  ? {
                      ...m,
                      passed: true,
                      passReason: '(unexpected empty response)',
                      retrievedTweets: retrieved,
                    }
                  : m,
              );
            }
            setMessages([...working]);
            continue;
          }

          // Text stream path
          if (!res.body) {
            working = working.map((m) =>
              m.id === placeholder.id
                ? { ...m, passed: true, passReason: '(no response body)' }
                : m,
            );
            setMessages([...working]);
            continue;
          }

          working = working.map((m) =>
            m.id === placeholder.id ? { ...m, retrievedTweets: retrieved } : m,
          );
          setMessages([...working]);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let acc = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
            working = working.map((m) => (m.id === placeholder.id ? { ...m, text: acc } : m));
            setMessages([...working]);
          }
          // The server prefixes upstream provider errors (rate limit,
          // billing, etc.) with this sentinel so we can render the real
          // reason instead of "(model returned empty response)" or worse,
          // displaying the error as if the persona had said it.
          const ERROR_SENTINEL = '__WWXD_STREAM_ERROR__';
          if (acc.includes(ERROR_SENTINEL)) {
            const errMsg = acc.split(ERROR_SENTINEL).pop()?.trim() ?? '';
            working = working.map((m) =>
              m.id === placeholder.id
                ? {
                    ...m,
                    text: '',
                    passed: true,
                    passReason: errMsg
                      ? `(${errMsg})`
                      : '(provider error)',
                  }
                : m,
            );
            setMessages([...working]);
          } else if (!acc.trim()) {
            // Don't silently vanish — show that the model returned nothing
            working = working.map((m) =>
              m.id === placeholder.id
                ? { ...m, passed: true, passReason: '(model returned empty response)' }
                : m,
            );
            setMessages([...working]);
          }
        } catch (err) {
          console.error(`[roundtable] @${persona.username} threw:`, err);
          working = working.map((m) =>
            m.id === placeholder.id
              ? {
                  ...m,
                  passed: true,
                  passReason: `(error: ${err instanceof Error ? err.message : String(err)})`,
                }
              : m,
          );
          setMessages([...working]);
        }
      }

      setStreamingFor(null);
      save(working);
    },
    [personas, save],
  );

  // React to external submission trigger
  useEffect(() => {
    if (!pendingSubmission) return;
    if (pendingSubmission.id === lastFiredId.current) return;
    lastFiredId.current = pendingSubmission.id;
    runRoundRobin(pendingSubmission.text);
    onConsumeSubmission();
  }, [pendingSubmission, runRoundRobin, onConsumeSubmission]);

  function clear(): void {
    setMessages([]);
    if (!conversationId) return; // compose mode — nothing to clear server-side
    mutate(
      (prev) => (prev ? { ...prev, messages: [] } : prev),
      { revalidate: false },
    );
    fetchJson(conversationMessagesUrl(conversationId), {
      method: 'DELETE',
      onErrorMessage: "Couldn't clear this roundtable on the server.",
    })
      .then(() => router.refresh())
      .catch(() => {});
  }

  const speakerDisplay = useMemo(
    () => new Map(personas.map((p) => [p.username, p.displayName])),
    [personas],
  );

  const hasHistory = messages.length > 0;

  const streamingStyle = streamingFor ? personaStyle(streamingFor) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5 text-xs text-[var(--ink-soft)]">
        <span className="min-w-0 flex-1 truncate">
          Round-robin: each turn, every persona speaks in order and can react to the others by name.
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <ShareButton
            kind="roundtable"
            title={
              groupName ??
              `Roundtable: ${personas.map((p) => p.displayName).join(', ')}`
            }
            personas={personas.map((p) => ({
              username: p.username,
              displayName: p.displayName,
            }))}
            messages={messages.map((m) => ({
              role: m.role,
              speaker: m.speaker ?? null,
              text: m.text,
            }))}
          />
          {hasHistory && (
            <button
              onClick={clear}
              className="rounded-full px-2 py-1 text-[var(--ink-soft)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            >
              clear
            </button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!pinned && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-[var(--shadow)] transition hover:-translate-x-1/2 hover:-translate-y-0.5"
            aria-label="Jump to latest"
            title="Jump to latest"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </button>
        )}
        <div ref={scrollRef} className="h-full space-y-5 overflow-y-auto bg-[var(--paper-2)] p-4">
        <ImpressionCard
          kind="roundtable"
          personas={personas.map((p) => ({
            username: p.username,
            displayName: p.displayName,
            mode: p.mode,
          }))}
        />
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">
            {personas.length === 0
              ? 'Pick at least one persona to start the roundtable.'
              : `Drop a question. ${personas
                  .map((p) => p.displayName)
                  .join(', ')} will respond in order, riffing on each other.`}
          </p>
        ) : (
          messages.map((m) => {
            const speakerName = m.speaker ? speakerDisplay.get(m.speaker) ?? m.speaker : '';
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div
                    className="max-w-[74%] whitespace-pre-wrap text-[15px] font-medium leading-snug text-white"
                    style={{
                      background: 'var(--ink)',
                      padding: '12px 17px',
                      borderRadius: '20px 20px 7px 20px',
                      boxShadow: '0 8px 18px rgba(20,18,10,0.14)',
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              );
            }
            const s = m.speaker ? personaStyle(m.speaker) : null;
            if (m.passed) {
              return (
                <div key={m.id} className="flex items-start gap-3">
                  {s && (
                    <span
                      className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden rounded-full opacity-50"
                      style={{ background: tintHex(s.color, 0.16) }}
                    >
                      <PersonaAvatar color={s.color} crown={s.crown} size={36} eyeColor="#fff" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className="flex items-center gap-1.5 font-display text-[13.5px] font-bold opacity-60"
                      style={{ color: s?.color }}
                    >
                      <span>{speakerName}</span>
                      <AIBadge size="xs" tone={s?.color} />
                    </div>
                    <div className="mt-1 text-sm italic leading-relaxed text-[var(--ink-soft)]">
                      <span className="mr-1.5 inline-block rounded-full bg-[var(--paper-2)] px-2 py-0.5 font-display text-[9px] font-bold uppercase not-italic tracking-wide text-[var(--ink-soft)]">
                        passed
                      </span>
                      {m.passReason}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="wwxd-pop flex max-w-[92%] items-start gap-3">
                {s && (
                  <span
                    className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden rounded-full"
                    style={{ background: tintHex(s.color, 0.16) }}
                  >
                    <span className="wwxd-bob">
                      <PersonaAvatar color={s.color} crown={s.crown} size={36} eyeColor="#fff" />
                    </span>
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className="mb-1 flex items-center gap-1.5 font-display text-[13.5px] font-bold"
                    style={{ color: s?.color }}
                  >
                    <span>{speakerName}</span>
                    <AIBadge size="xs" tone={s?.color} />
                  </div>
                  <div
                    className="prose prose-sm max-w-none text-[15px] leading-relaxed text-[var(--ink-2)]"
                    style={{
                      background: '#fff',
                      border: '1.5px solid var(--line)',
                      padding: '12px 16px',
                      borderRadius: '7px 19px 19px 19px',
                      boxShadow: '0 2px 8px rgba(20,18,10,0.04)',
                    }}
                  >
                    {m.text ? (
                      <>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {renderCitationMarkers(m.text, m.speaker ?? '', m.retrievedTweets ?? [])}
                        </ReactMarkdown>
                        <SourcesPanel
                          tweets={m.retrievedTweets ?? []}
                          citedIds={extractCitedIds(m.text)}
                        />
                      </>
                    ) : (
                      <span className="inline-flex gap-1">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--ink-faint)]" />
                        <span
                          className="h-2 w-2 animate-pulse rounded-full bg-[var(--ink-faint)]"
                          style={{ animationDelay: '0.16s' }}
                        />
                        <span
                          className="h-2 w-2 animate-pulse rounded-full bg-[var(--ink-faint)]"
                          style={{ animationDelay: '0.32s' }}
                        />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {streamingFor && (
          <div
            className="text-xs italic"
            style={{ color: streamingStyle?.color ?? 'var(--ink-soft)' }}
          >
            {speakerDisplay.get(streamingFor) ?? streamingFor} is typing...
          </div>
        )}
        {error && (
          <div className="rounded-[var(--r)] border border-red-300 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
