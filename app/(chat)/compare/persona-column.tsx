'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AIBadge } from '@/app/components/ai-badge';
import { CitedBadge } from '@/app/components/cited-badge';
import { PersonaAvatar } from '@/app/components/persona-avatar';
import { RelativeTime } from '@/app/components/relative-time';
import { useChatHistory } from '@/app/components/use-chat-history';
import { useStickyScroll } from '@/app/components/use-sticky-scroll';
import {
  SourcesPanel,
  extractCitedIds,
  renderCitationMarkers,
  type RetrievedTweetMeta,
} from '@/app/components/sources-panel';
import { personaStyle, tintHex } from '@/lib/persona-styling';
import type { PersonaSummary } from './compare';

type ChatMessageMetadata = { retrievedTweets?: RetrievedTweetMeta[] } | undefined;

export type Submission = { id: number; text: string };

/**
 * Single persona's column in `/compare?mode=compare`. Self-contained — owns
 * its own useChat instance plus the SWR-backed history hydration via
 * useChatHistory. The parent passes in a `submission` to broadcast the same
 * user prompt across all columns; the column fires it once via the
 * lastFiredId guard.
 */
export function PersonaColumn({
  persona,
  submission,
  onRemove,
}: {
  persona: PersonaSummary;
  submission: Submission | null;
  onRemove: () => void;
}) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/chat/${persona.username}` }),
    [persona.username],
  );
  const saveRef = useRef<((m: UIMessage[]) => void) | null>(null);
  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onFinish: ({ messages: finalMessages }) => {
      saveRef.current?.(finalMessages);
    },
  });
  const { clear, hasHistory, saveAfterFinish } = useChatHistory({
    username: persona.username,
    messages,
    setMessages,
  });
  saveRef.current = saveAfterFinish;
  const lastFiredId = useRef<number | null>(null);
  const { ref: scrollRef, pinned, scrollToBottom, ping } = useStickyScroll<HTMLDivElement>();

  useEffect(() => {
    if (!submission) return;
    if (submission.id === lastFiredId.current) return;
    lastFiredId.current = submission.id;
    sendMessage({ text: submission.text });
  }, [submission, sendMessage]);

  useEffect(() => {
    ping();
  }, [messages, ping]);

  const isBusy = status === 'submitted' || status === 'streaming';
  const style = personaStyle(persona.username);
  const avatarBg = tintHex(style.color, 0.16);

  return (
    <section className="flex min-h-0 flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
        <span
          className="flex shrink-0 items-end justify-center overflow-hidden rounded-full"
          style={{ width: 36, height: 36, background: avatarBg }}
        >
          <span className="wwxd-bob">
            <PersonaAvatar color={style.color} crown={style.crown} size={32} eyeColor="#fff" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-1.5 font-display text-sm font-extrabold"
            style={{ color: style.color }}
          >
            <span className="truncate">{persona.displayName}</span>
            <AIBadge size="xs" tone={style.color} />
            {persona.mode !== 'prior-only' && <CitedBadge size="xs" tone={style.color} />}
          </div>
          <div className="truncate text-xs text-[var(--ink-soft)]">
            {persona.mode === 'prior-only' ? (
              <>
                from memory
                {persona.fetchedAt && (
                  <>
                    {' · created '}
                    <RelativeTime iso={persona.fetchedAt} />
                  </>
                )}
              </>
            ) : (
              <>
                <a
                  href={`https://x.com/${persona.username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  @{persona.username}
                </a>
                {' · '}
                {persona.tweetCount.toLocaleString()} tweets
                {persona.fetchedAt && (
                  <>
                    {' · '}
                    <RelativeTime iso={persona.fetchedAt} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasHistory && (
            <button
              onClick={clear}
              className="rounded-full px-2 py-1 text-[10px] text-[var(--ink-soft)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
              title="Clear conversation history"
            >
              clear
            </button>
          )}
          <button
            onClick={onRemove}
            className="rounded-full p-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            aria-label={`Remove ${persona.displayName}`}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!pinned && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-2 left-1/2 z-10 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-[var(--shadow-sm)] transition hover:-translate-x-1/2 hover:-translate-y-0.5"
            aria-label="Jump to latest"
            title="Jump to latest"
          >
            <svg
              width="13"
              height="13"
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
        <div ref={scrollRef} className="h-full space-y-4 overflow-y-auto bg-[var(--paper-2)] p-3">
          {messages.length === 0 ? (
            <p className="text-xs text-[var(--ink-soft)]">
              {`No messages yet. ${persona.displayName} answers with citations to his actual tweets.`}
            </p>
          ) : (
            messages.map((m) => {
              const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div
                      className="max-w-[88%] whitespace-pre-wrap text-[14px] font-medium leading-snug text-white"
                      style={{
                        background: 'var(--ink)',
                        padding: '10px 14px',
                        borderRadius: '18px 18px 6px 18px',
                      }}
                    >
                      {text}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className="flex flex-col gap-1">
                  <div
                    className="flex items-center gap-1.5 font-display text-[12px] font-bold"
                    style={{ color: style.color }}
                  >
                    <span>{persona.displayName}</span>
                    <AIBadge size="xs" tone={style.color} />
                  </div>
                  <div
                    className="prose prose-sm max-w-none text-[14px] leading-relaxed text-[var(--ink-2)]"
                    style={{
                      background: '#fff',
                      border: '1.5px solid var(--line)',
                      padding: '10px 14px',
                      borderRadius: '6px 17px 17px 17px',
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {renderCitationMarkers(
                        text,
                        persona.username,
                        (m.metadata as ChatMessageMetadata)?.retrievedTweets ?? [],
                      )}
                    </ReactMarkdown>
                    <SourcesPanel
                      tweets={(m.metadata as ChatMessageMetadata)?.retrievedTweets ?? []}
                      citedIds={extractCitedIds(text)}
                    />
                  </div>
                </div>
              );
            })
          )}
          {isBusy && (
            <div className="text-xs italic text-[var(--ink-soft)]">{`${persona.displayName} is typing...`}</div>
          )}
          {error && (
            <div className="rounded-[var(--r)] border border-red-300 bg-red-50 p-2 text-xs text-red-800">
              {error.message}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
