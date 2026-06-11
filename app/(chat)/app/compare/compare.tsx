'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AIBadge } from '@/app/components/ai-badge';
import { CitedBadge } from '@/app/components/cited-badge';
import { fetchJson } from '@/app/components/fetch-utils';
import { ImpressionCard } from '@/app/components/impression-card';
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
import { RoundtableView } from './roundtable';

type ChatMessageMetadata = { retrievedTweets?: RetrievedTweetMeta[] } | undefined;

type Mode = 'compare' | 'roundtable';

export type PersonaSummary = {
  username: string;
  displayName: string;
  tweetCount: number;
  fetchedAt: string;
  hasEmbeddings: boolean;
  mode?: 'grounded' | 'prior-only';
};

type Submission = { id: number; text: string };


function PersonaColumn({
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
              // Prior-only personas have no X handle to link to and no
              // tweet count worth showing. Surface the mode + creation
              // time instead.
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

type CurrentGroup = {
  id: string;
  name: string;
  personas: string[];
} | null;

export function Compare({
  personas,
  currentGroup,
}: {
  personas: PersonaSummary[];
  currentGroup: CurrentGroup;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get('personas') ?? '';
  const modeParam = (searchParams.get('mode') as Mode | null) ?? 'compare';
  const mode: Mode = modeParam === 'roundtable' ? 'roundtable' : 'compare';

  const selectedUsernames = useMemo(
    () =>
      selectedParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [selectedParam],
  );
  const selected = useMemo(
    () =>
      selectedUsernames
        .map((u) => personas.find((p) => p.username === u))
        .filter((p): p is PersonaSummary => Boolean(p)),
    [selectedUsernames, personas],
  );
  const available = personas.filter((p) => !selectedUsernames.includes(p.username));

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(selected.length === 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Group naming
  const [nameEditing, setNameEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameEditing) nameInputRef.current?.focus();
  }, [nameEditing]);

  function startNaming(initial = '') {
    setNameInput(initial);
    setNameEditing(true);
  }
  function cancelNaming() {
    setNameEditing(false);
    setNameInput('');
  }

  // Close the persona picker on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      const el = pickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const writeUrl = useCallback(
    (usernames: string[], nextMode: Mode) => {
      const params = new URLSearchParams();
      if (usernames.length > 0) params.set('personas', usernames.join(','));
      if (nextMode !== 'compare') params.set('mode', nextMode);
      if (
        currentGroup &&
        currentGroup.personas.length === usernames.length &&
        currentGroup.personas.every((u) => usernames.includes(u))
      ) {
        params.set('group', currentGroup.id);
      }
      const qs = params.toString();
      router.replace(qs ? `/app/compare?${qs}` : '/app/compare');
    },
    [router, currentGroup],
  );

  const matchedGroup =
    currentGroup &&
    currentGroup.personas.length === selectedUsernames.length &&
    currentGroup.personas.every((u) => selectedUsernames.includes(u))
      ? currentGroup
      : null;

  async function saveGroupName(e: React.FormEvent) {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name || savingName) return;
    setSavingName(true);
    try {
      if (matchedGroup) {
        await fetchJson(`/api/groups/${matchedGroup.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
          onErrorMessage: "Couldn't rename this group.",
        });
        setNameEditing(false);
        setNameInput('');
        router.refresh();
      } else {
        const { group } = await fetchJson<{ group: { id: string } }>(
          '/api/groups',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, personas: selectedUsernames }),
            onErrorMessage: "Couldn't save this group.",
          },
        );
        setNameEditing(false);
        setNameInput('');
        const params = new URLSearchParams();
        params.set('personas', selectedUsernames.join(','));
        if (mode !== 'compare') params.set('mode', mode);
        params.set('group', group.id);
        router.replace(`/app/compare?${params.toString()}`);
        router.refresh();
      }
    } catch {
      // fetchJson already surfaced a toast
    } finally {
      setSavingName(false);
    }
  }

  function add(username: string) {
    writeUrl([...selectedUsernames, username], mode);
    setPickerOpen(false);
  }

  function remove(username: string) {
    writeUrl(
      selectedUsernames.filter((u) => u !== username),
      mode,
    );
  }

  function setMode(next: Mode) {
    writeUrl(selectedUsernames, next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || selected.length === 0) return;
    setSubmission({ id: Date.now(), text });
    setInput('');
    inputRef.current?.focus();
  }

  const submitLabel = mode === 'roundtable' ? 'Ask roundtable' : 'Ask all';
  const placeholder =
    selected.length === 0
      ? 'Pick at least one persona above first...'
      : mode === 'roundtable'
        ? `Roundtable with ${selected.map((p) => p.displayName).join(', ')}...`
        : `Ask ${selected.map((p) => p.displayName).join(', ')}...`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--paper-2)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-white/85 px-6 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="truncate font-display text-lg font-extrabold tracking-tight text-[var(--ink)]">
              {mode === 'roundtable' ? 'Roundtable' : 'Compare personas'}
              {matchedGroup && !nameEditing && (
                <span className="ml-2 font-normal text-[var(--ink-soft)]">
                  · {matchedGroup.name}
                </span>
              )}
            </h1>
            {nameEditing ? (
              <form onSubmit={saveGroupName} className="flex items-center gap-1.5">
                <input
                  ref={nameInputRef}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelNaming();
                    }
                  }}
                  placeholder={matchedGroup ? 'Group name' : 'Name this group'}
                  maxLength={60}
                  className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
                <button
                  type="submit"
                  disabled={!nameInput.trim() || savingName}
                  className="rounded-full bg-[var(--ink)] px-2.5 py-1 font-display text-xs font-bold text-white disabled:opacity-50"
                >
                  {savingName ? 'saving…' : 'save'}
                </button>
                <button
                  type="button"
                  onClick={cancelNaming}
                  className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
                >
                  cancel
                </button>
              </form>
            ) : selected.length >= 2 ? (
              matchedGroup ? (
                <button
                  type="button"
                  onClick={() => startNaming(matchedGroup.name)}
                  title="Rename group"
                  className="text-[11px] text-[var(--ink-faint)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
                >
                  rename
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startNaming('')}
                  className="rounded-full border border-dashed border-[var(--ink-faint)] bg-white px-2.5 py-1 font-display text-xs font-bold text-[var(--ink-soft)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                >
                  + save as group
                </button>
              )
            ) : null}
          </div>
          <p className="text-xs text-[var(--ink-soft)]">
            {mode === 'roundtable'
              ? 'Everyone in the same conversation. Each turn, they speak in order and can react.'
              : 'One question, multiple personas, parallel columns.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div
            role="radiogroup"
            aria-label="view mode"
            className="flex rounded-full border border-[var(--line)] bg-white p-0.5 font-display text-xs font-bold"
          >
            <button
              role="radio"
              aria-checked={mode === 'compare'}
              onClick={() => setMode('compare')}
              className={`rounded-full px-3 py-1.5 transition ${
                mode === 'compare' ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'
              }`}
            >
              compare
            </button>
            <button
              role="radio"
              aria-checked={mode === 'roundtable'}
              onClick={() => setMode('roundtable')}
              className={`rounded-full px-3 py-1.5 transition ${
                mode === 'roundtable'
                  ? 'bg-[var(--ink)] text-white'
                  : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'
              }`}
            >
              roundtable
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        {selected.map((p) => {
          const s = personaStyle(p.username);
          const isPriorOnly = p.mode === 'prior-only';
          return (
            <span
              key={p.username}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 font-display text-xs font-bold text-[var(--ink)] shadow-[var(--shadow-sm)]"
              // Dashed border on prior-only chips telegraphs "lighter weight,
              // no curated corpus" at a glance, even before the user reads
              // the displayName or the impression-card disclaimer.
              style={{ border: `1.5px ${isPriorOnly ? 'dashed' : 'solid'} ${s.color}` }}
              title={
                isPriorOnly
                  ? `${p.displayName} — no curated sources. Replies come from the model's memory.`
                  : undefined
              }
            >
              <span
                className="flex h-5 w-5 items-end justify-center overflow-hidden rounded-full"
                style={{ background: tintHex(s.color, 0.16) }}
              >
                <PersonaAvatar color={s.color} crown={s.crown} size={18} eyeColor="#fff" />
              </span>
              {p.displayName}
              {!isPriorOnly && <CitedBadge size="xs" tone={s.color} />}
              <button
                onClick={() => remove(p.username)}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${p.displayName}`}
              >
                ✕
              </button>
            </span>
          );
        })}
        {available.length > 0 && (
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="rounded-full border border-dashed border-[var(--ink-faint)] bg-white px-3 py-1 font-display text-xs font-bold text-[var(--ink-soft)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              + add persona
            </button>
            {pickerOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-[var(--r)] border border-[var(--line)] bg-white shadow-[var(--shadow)]">
                {available.map((p) => {
                  const s = personaStyle(p.username);
                  return (
                    <button
                      key={p.username}
                      onClick={() => add(p.username)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--paper-2)]"
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-end justify-center overflow-hidden rounded-full"
                        style={{ background: tintHex(s.color, 0.16) }}
                      >
                        <PersonaAvatar
                          color={s.color}
                          crown={s.crown}
                          size={24}
                          eyeColor="#fff"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-xs font-bold text-[var(--ink)]">
                          {p.displayName}
                        </div>
                        <div className="truncate text-[10px] text-[var(--ink-soft)]">
                          @{p.username} · {p.tweetCount.toLocaleString()} tweets
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-2">
        {selected.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-8 text-sm text-[var(--ink-soft)]">
            Pick at least one persona to start.
          </div>
        ) : mode === 'roundtable' ? (
          <RoundtableView
            personas={selected}
            pendingSubmission={submission}
            onConsumeSubmission={() => setSubmission(null)}
            groupName={matchedGroup?.name}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <ImpressionCard
              kind="solo"
              personas={selected.map((p) => ({
                username: p.username,
                displayName: p.displayName,
                mode: p.mode,
              }))}
            />
            <div
              className="grid min-h-0 flex-1 grid-cols-1 gap-3 max-md:overflow-y-auto md:grid-cols-[var(--cols)]"
              style={
                {
                  // Stack vertically on mobile (1 col), parallel columns ≥md.
                  '--cols': `repeat(${selected.length}, minmax(0, 1fr))`,
                } as React.CSSProperties
              }
            >
              {selected.map((p) => (
                <PersonaColumn
                  key={p.username}
                  persona={p}
                  submission={submission}
                  onRemove={() => remove(p.username)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-b from-transparent to-[var(--paper-2)] px-6 pb-5 pt-2">
        <form
          onSubmit={onSubmit}
          className="mx-auto flex max-w-[760px] items-center gap-2 rounded-full border border-[var(--line)] bg-white px-2 py-2 shadow-[var(--shadow-sm)]"
        >
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent px-3 text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          <button
            type="submit"
            disabled={!input.trim() || selected.length === 0}
            className="rounded-full bg-[var(--ink)] px-4 py-2 font-display text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
