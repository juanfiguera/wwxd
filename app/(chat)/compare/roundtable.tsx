'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useSWR from 'swr';
import { AIBadge } from '@/app/components/ai-badge';
import { CopyButton } from '@/app/components/copy-button';
import { markdownComponents } from '@/app/components/markdown-components';
import { ImpressionCard } from '@/app/components/impression-card';
import { PersonaAvatar } from '@/app/components/persona-avatar';
import { ShareButton } from '@/app/components/share-button';
import { readSse } from '@/app/components/sse-reader';
import { useStickyScroll } from '@/app/components/use-sticky-scroll';
import {
  conversationFetcher,
  conversationMessagesUrl,
  roundtableKey as roundtableSWRKey,
  type Conversation,
} from '@/app/components/conversation-cache';
import { fetchJson } from '@/app/components/fetch-utils';
import {
  SourcesPanel,
  extractCitedIds,
  renderCitationMarkers,
  type RetrievedTweetMeta,
} from '@/app/components/sources-panel';
import { personaStyle, tintHex } from '@/lib/persona-styling';
import { buildSnapshot, snapshotToPlainText } from '@/lib/share';
import type { PersonaSummary } from './compare';
import {
  rtToStored,
  storedToRt,
  uid,
  type RoundtableMessage,
} from './roundtable-message';

/** Fisher-Yates shuffle into a new array; the input is left untouched. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type { RoundtableMessage };

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

      // Speak in a fresh random order each turn. With a fixed order the same
      // personas always led and the same ones always landed in "everything's
      // been said" cleanup mode — a major driver of convergent replies.
      // Shuffle a copy so the displayed roster (ParticipantsBar, etc.) stays
      // in its stable order.
      const speakingOrder = shuffle(personas);

      // Gating is sequential and inline (handled inside /api/roundtable). Each
      // persona's gate therefore sees who has already spoken THIS turn and can
      // pass when its take would only echo the room. A parallel pre-pass can't
      // do that — at pre-pass time nobody has spoken yet, so it can't catch
      // within-turn redundancy.
      for (const persona of speakingOrder) {
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
              ...(conversationId
                ? { conversationId, assistantMessageId: placeholder.id }
                : {}),
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
          if (!res.body) {
            working = working.map((m) =>
              m.id === placeholder.id
                ? { ...m, passed: true, passReason: '(no response body)' }
                : m,
            );
            setMessages([...working]);
            continue;
          }

          // Phase 2.1 wire format: text/event-stream with typed events.
          //   meta → retrieved tweets metadata
          //   text → accumulated reply chunk
          //   gate-passed → persona declined, reason in payload
          //   error → upstream provider error (replaces the old sentinel)
          //   done → server is closing the stream
          let acc = '';
          let retrieved: RetrievedTweetMeta[] = [];
          let passReason: string | null = null;
          let errorReason: string | null = null;
          for await (const ev of readSse(res.body)) {
            if (ev.event === 'meta') {
              const data = ev.data as { retrievedTweets?: RetrievedTweetMeta[] };
              retrieved = data.retrievedTweets ?? [];
              working = working.map((m) =>
                m.id === placeholder.id ? { ...m, retrievedTweets: retrieved } : m,
              );
              setMessages([...working]);
            } else if (ev.event === 'text') {
              const data = ev.data as { value: string };
              acc += data.value;
              working = working.map((m) =>
                m.id === placeholder.id ? { ...m, text: acc } : m,
              );
              setMessages([...working]);
            } else if (ev.event === 'gate-passed') {
              const data = ev.data as { reason: string };
              passReason = data.reason ?? 'no comment';
            } else if (ev.event === 'error') {
              const data = ev.data as { message: string };
              errorReason = data.message ?? '';
            } else if (ev.event === 'done') {
              break;
            }
          }
          if (passReason !== null) {
            working = working.map((m) =>
              m.id === placeholder.id
                ? {
                    ...m,
                    passed: true,
                    passReason,
                    retrievedTweets: retrieved,
                  }
                : m,
            );
            setMessages([...working]);
          } else if (errorReason !== null) {
            working = working.map((m) =>
              m.id === placeholder.id
                ? {
                    ...m,
                    text: '',
                    passed: true,
                    passReason: errorReason
                      ? `(${errorReason})`
                      : '(provider error)',
                  }
                : m,
            );
            setMessages([...working]);
          } else if (!acc.trim()) {
            // Stream closed without text, gate-passed, or error — surface it
            // instead of silently vanishing.
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

  // Flattened messages for share/copy. Drop empty turns (streaming
  // placeholders, gate-passed slots) so they don't render as blank lines.
  const shareMessages = messages
    .map((m) => ({
      role: m.role,
      speaker: m.speaker ?? null,
      text: m.text,
    }))
    .filter((m) => m.text.trim().length > 0);

  const streamingStyle = streamingFor ? personaStyle(streamingFor) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5 text-xs text-[var(--ink-soft)]">
        <span className="min-w-0 flex-1 truncate">
          Everyone in the same conversation. Each turn, they speak in order, riffing on each other.
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {shareMessages.length > 0 && (
            <CopyButton
              getText={() =>
                snapshotToPlainText(
                  buildSnapshot({
                    kind: 'roundtable',
                    title:
                      groupName ??
                      `Roundtable: ${personas.map((p) => p.displayName).join(', ')}`,
                    personas: personas.map((p) => ({
                      username: p.username,
                      displayName: p.displayName,
                    })),
                    messages: shareMessages,
                  }),
                )
              }
              title="Copy whole roundtable"
              label="copy"
              className="hidden items-center gap-1 rounded-full px-2 py-1 text-[var(--ink-soft)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)] md:inline-flex"
            />
          )}
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
            messages={shareMessages}
          />
          {conversationId && (
            <a
              href={`/evals/conversations/${conversationId}`}
              className="rounded-full px-2 py-1 text-[var(--ink-soft)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
              title="Show the trace of gate decisions, retrieval hits, and errors for this conversation"
            >
              trace
            </a>
          )}
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
          personas.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">
              Pick at least one persona to start the roundtable.
            </p>
          ) : null
        ) : (
          messages.map((m) => {
            const speakerName = m.speaker ? speakerDisplay.get(m.speaker) ?? m.speaker : '';
            if (m.role === 'user') {
              return (
                <div key={m.id} className="group/msg flex justify-end">
                  <div className="flex max-w-[74%] flex-col items-start">
                    <div
                      className="whitespace-pre-wrap text-[15px] font-medium leading-snug text-white"
                      style={{
                        background: 'var(--ink)',
                        padding: '12px 17px',
                        borderRadius: '20px 20px 7px 20px',
                        boxShadow: '0 8px 18px rgba(20,18,10,0.14)',
                      }}
                    >
                      {m.text}
                    </div>
                    <CopyButton
                      getText={() => m.text}
                      title="Copy message"
                      iconSize={13}
                      className="mt-1.5 flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-white hover:text-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
                    />
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
              <div
                key={m.id}
                className="wwxd-pop group/msg flex max-w-[92%] items-start gap-3"
              >
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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
                  {m.text && (
                    <CopyButton
                      getText={() => m.text}
                      title="Copy message"
                      iconSize={13}
                      className="mt-1.5 flex h-7 w-7 items-center justify-center self-start rounded-full text-[var(--ink-faint)] transition hover:bg-white hover:text-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
        {streamingFor && (
          <div className="flex items-start gap-3">
            {/* Spacer matching the avatar so the text aligns with the bubble. */}
            <span className="w-10 shrink-0" aria-hidden />
            <div
              className="text-xs italic"
              style={{ color: streamingStyle?.color ?? 'var(--ink-soft)' }}
            >
              {speakerDisplay.get(streamingFor) ?? streamingFor} is typing...
            </div>
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
