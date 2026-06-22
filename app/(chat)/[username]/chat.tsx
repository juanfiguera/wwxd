'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AccentTheme } from '@/app/components/accent-theme';
import { AIBadge } from '@/app/components/ai-badge';
import { ChatInput } from '@/app/components/chat-input';
import { CitedBadge } from '@/app/components/cited-badge';
import { CopyButton } from '@/app/components/copy-button';
import { ImpressionCard } from '@/app/components/impression-card';
import { PersonaAvatar } from '@/app/components/persona-avatar';
import { PullProgress } from '@/app/components/pull-progress';
import { RelativeTime } from '@/app/components/relative-time';
import { ShareButton } from '@/app/components/share-button';
import { useChatHistory } from '@/app/components/use-chat-history';
import { usePullJob } from '@/app/components/use-pull-job';
import { useStickyScroll } from '@/app/components/use-sticky-scroll';
import {
  SourcesPanel,
  extractCitedIds,
  renderCitationMarkers,
  type RetrievedTweetMeta,
} from '@/app/components/sources-panel';
import { personaStyle, tintHex } from '@/lib/persona-styling';
import { buildSnapshot, snapshotToPlainText } from '@/lib/share';

type ChatMessageMetadata = { retrievedTweets?: RetrievedTweetMeta[] } | undefined;

type ChatProps = {
  username: string;
  displayName: string;
  tweetCount: number;
  fetchedAt: string;
  mode?: 'grounded' | 'prior-only';
};

export function Chat({ username, displayName, tweetCount, fetchedAt, mode }: ChatProps) {
  // conversationIdRef is read inside the transport's body function on every
  // request, so the engine receives the latest id once useChatHistory has
  // resolved it (which happens after the first SWR fetch). Initial requests
  // before SWR resolves go without a conversationId — events for those turns
  // are simply not persisted, same as before this hookup.
  const conversationIdRef = useRef<string | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/chat/${username}`,
        body: () => {
          const id = conversationIdRef.current;
          return id ? { conversationId: id } : {};
        },
      }),
    [username],
  );
  const saveRef = useRef<((m: UIMessage[]) => void) | null>(null);
  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onFinish: ({ messages: finalMessages }) => {
      saveRef.current?.(finalMessages);
    },
  });
  const { clear, hasHistory, saveAfterFinish, conversationId } = useChatHistory({
    username,
    messages,
    setMessages,
  });
  conversationIdRef.current = conversationId;
  saveRef.current = saveAfterFinish;
  const [input, setInput] = useState('');
  // Deep historical tweet pull, triggered from the header. Same job the sidebar
  // rail runs; on completion usePullJob calls router.refresh(), which re-runs
  // the server page and updates tweetCount / fetchedAt without dropping the
  // in-flight chat state.
  const { status: pullStatus, start: startPull, reset: resetPull } = usePullJob();
  const isPulling = pullStatus.state === 'running';
  const { ref: scrollRef, pinned, scrollToBottom, ping } = useStickyScroll<HTMLDivElement>();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const style = personaStyle(username);
  const avatarBg = tintHex(style.color, 0.16);

  useEffect(() => {
    ping();
  }, [messages, ping]);

  const isBusy = status === 'submitted' || status === 'streaming';

  // Flattened messages for share/copy. Empty turns (e.g. a gate-passed
  // assistant slot) are dropped so they don't show up as blank lines.
  const shareMessages = messages
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      text: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
    }))
    .filter((m) => m.text.trim().length > 0);

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    sendMessage({ text });
    setInput('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AccentTheme color={style.color} />
      <header className="flex items-center gap-3 border-b border-[var(--line)] bg-white/85 px-4 py-3.5 backdrop-blur md:px-6">
        <span
          className="flex shrink-0 items-end justify-center overflow-hidden rounded-full"
          style={{ width: 52, height: 52, background: avatarBg }}
        >
          <span className="wwxd-bob">
            <PersonaAvatar
              color={style.color}
              crown={style.crown}
              size={48}
              eyeColor="#ffffff"
              title={displayName}
            />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="flex min-w-0 items-center gap-2 truncate font-display text-xl font-extrabold tracking-tight text-[var(--ink)]">
              <span className="truncate">{displayName}</span>
              <AIBadge tone={style.color} />
              {mode !== 'prior-only' && <CitedBadge tone={style.color} />}
            </h1>
            <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--ink-soft)]">
              {shareMessages.length > 0 && (
                <CopyButton
                  getText={() =>
                    snapshotToPlainText(
                      buildSnapshot({
                        kind: 'solo',
                        personas: [{ username, displayName }],
                        messages: shareMessages,
                      }),
                    )
                  }
                  title="Copy whole chat"
                  label="copy chat"
                  className="hidden items-center gap-1 underline-offset-2 hover:text-[var(--ink)] hover:underline md:inline-flex"
                />
              )}
              <ShareButton
                kind="solo"
                personas={[{ username, displayName }]}
                messages={shareMessages}
                accentColor={style.color}
              />
              {hasHistory && (
                <button
                  onClick={clear}
                  className="hidden underline-offset-2 hover:text-[var(--ink)] hover:underline md:inline"
                >
                  clear history
                </button>
              )}
            </div>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--ink-soft)]">
            <span className="min-w-0 truncate">
              {mode === 'prior-only' ? (
                <>
                  from memory
                  {fetchedAt ? (
                    <>
                      {' · created '}
                      <RelativeTime iso={fetchedAt} />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <a
                    href={`https://x.com/${username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                    style={{ color: style.color }}
                  >
                    @{username}
                  </a>
                  {` · ${tweetCount.toLocaleString()} tweets`}
                  {fetchedAt ? (
                    <>
                      {' · updated '}
                      <RelativeTime iso={fetchedAt} />
                    </>
                  ) : null}
                </>
              )}
            </span>
            {mode !== 'prior-only' && (
              <button
                type="button"
                onClick={() => startPull(username, { mode: 'deep' })}
                disabled={isPulling}
                title={
                  isPulling
                    ? 'Loading more tweets…'
                    : 'Load more tweets (walk back through full history)'
                }
                aria-label={`Load more tweets for ${displayName}`}
                className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[var(--ink-faint)] transition hover:bg-[var(--line-2)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                <span
                  className={
                    isPulling
                      ? 'inline-block animate-spin text-[12px] leading-none'
                      : 'inline-block text-[12px] leading-none'
                  }
                >
                  ↻
                </span>
                <span className="font-display text-[11px] font-bold">
                  {isPulling ? 'Loading…' : 'Load more'}
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {pullStatus.state !== 'idle' && (
        <div className="border-b border-[var(--line)] bg-[var(--paper-2)] px-4 py-3 md:px-6">
          <div className="mx-auto max-w-[960px]">
            <PullProgress status={pullStatus} onDismiss={resetPull} />
          </div>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto bg-[var(--paper-2)]">
        <div className="mx-auto max-w-[960px] space-y-5 px-4 py-6 md:px-6">
        <ImpressionCard kind="solo" personas={[{ username, displayName, mode }]} />
        {messages.length === 0 ? null : (
          messages.map((m) => {
            const text = m.parts
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('');
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
                      {text}
                    </div>
                    <CopyButton
                      getText={() => text}
                      title="Copy message"
                      iconSize={13}
                      className="mt-1.5 flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-white hover:text-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
                    />
                  </div>
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className="group/msg flex max-w-[92%] items-start gap-3"
              >
                <span
                  className="flex shrink-0 items-end justify-center overflow-hidden rounded-full"
                  style={{ width: 40, height: 40, background: avatarBg }}
                >
                  <PersonaAvatar
                    color={style.color}
                    crown={style.crown}
                    size={36}
                    eyeColor="#ffffff"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="mb-1 flex items-center gap-1.5 font-display text-[13.5px] font-bold"
                    style={{ color: style.color }}
                  >
                    <span>{displayName}</span>
                    <AIBadge size="xs" tone={style.color} />
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {renderCitationMarkers(
                        text,
                        username,
                        (m.metadata as ChatMessageMetadata)?.retrievedTweets ?? [],
                      )}
                    </ReactMarkdown>
                    <SourcesPanel
                      tweets={(m.metadata as ChatMessageMetadata)?.retrievedTweets ?? []}
                      citedIds={extractCitedIds(text)}
                    />
                  </div>
                  <CopyButton
                    getText={() => text}
                    title="Copy message"
                    iconSize={13}
                    className="mt-1.5 flex h-7 w-7 items-center justify-center self-start rounded-full text-[var(--ink-faint)] transition hover:bg-white hover:text-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
                  />
                </div>
              </div>
            );
          })
        )}
        {isBusy && (
          <div className="text-xs italic text-[var(--ink-soft)]">
            {`${displayName} is typing...`}
          </div>
        )}
        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error.message}
          </div>
        )}
        </div>
        </div>
        {!pinned && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-3 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-[var(--shadow)] transition hover:-translate-x-1/2 hover:-translate-y-0.5"
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
      </div>

      <div className="bg-gradient-to-b from-transparent to-[var(--paper)] px-3 pb-5 pt-2 md:px-6">
        <form
          onSubmit={onSubmit}
          className="mx-auto flex max-w-[960px] items-center gap-2 rounded-[28px] border border-[var(--line)] bg-white px-2 py-2 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow]"
          style={{
            borderColor: isBusy ? style.color : undefined,
          }}
        >
          <ChatInput
            ref={inputRef}
            autoFocus
            value={input}
            onChange={setInput}
            onSubmit={onSubmit}
            disableSubmit={isBusy || !input.trim()}
            placeholder={`Ask ${displayName} anything...`}
            aria-label={`Message ${displayName}`}
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full text-white transition-transform disabled:opacity-50"
            style={{ background: style.color }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
