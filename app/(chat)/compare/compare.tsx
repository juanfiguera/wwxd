'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIBadge } from '@/app/components/ai-badge';
import { ChatInput } from '@/app/components/chat-input';
import { CitedBadge } from '@/app/components/cited-badge';
import { fetchJson } from '@/app/components/fetch-utils';
import { ImpressionCard } from '@/app/components/impression-card';
import { PersonaAvatar } from '@/app/components/persona-avatar';
import { personaStyle, tintHex } from '@/lib/persona-styling';
import { ParticipantsBar } from './participants-bar';
import { PersonaColumn, type Submission } from './persona-column';
import { RoundtableView } from './roundtable';

type Mode = 'compare' | 'roundtable';

export type PersonaSummary = {
  username: string;
  displayName: string;
  tweetCount: number;
  fetchedAt: string;
  hasEmbeddings: boolean;
  mode?: 'grounded' | 'prior-only';
};

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
  // Active roundtable conversation id, if any. Compose URLs (no active
  // conversation yet) leave this null.
  const conversationId = searchParams.get('conversation');

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Group naming
  const [nameEditing, setNameEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [existingNames, setExistingNames] = useState<{ id: string; name: string }[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameEditing) nameInputRef.current?.focus();
  }, [nameEditing]);

  // Pull the list of existing group names when the rename/save input opens so
  // we can warn inline if the user types a name that's already taken. The API
  // also enforces uniqueness server-side, but a live hint saves a round trip
  // and prevents the toast-after-submit jank.
  useEffect(() => {
    if (!nameEditing) return;
    let cancelled = false;
    fetchJson<{ groups: { id: string; name: string }[] }>('/api/groups', {
      onErrorMessage: '', // silent — the live hint is best-effort
    })
      .then((res) => {
        if (cancelled) return;
        setExistingNames(res.groups.map((g) => ({ id: g.id, name: g.name })));
      })
      .catch(() => {
        // ignored — input still works, just no live hint
      });
    return () => {
      cancelled = true;
    };
  }, [nameEditing]);


  function startNaming(initial = '') {
    setNameInput(initial);
    setNameEditing(true);
  }
  function cancelNaming() {
    setNameEditing(false);
    setNameInput('');
  }


  const writeUrl = useCallback(
    (usernames: string[], nextMode: Mode, opts?: { conversationId?: string | null }) => {
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
      // Preserve the active conversation id across URL updates so adding /
      // removing participants doesn't drop the user back into compose mode.
      // Caller can pass null to explicitly clear it.
      const nextConvId =
        opts && 'conversationId' in opts ? opts.conversationId : conversationId;
      if (nextConvId) params.set('conversation', nextConvId);
      const qs = params.toString();
      router.replace(qs ? `/compare?${qs}` : '/compare');
    },
    [router, currentGroup, conversationId],
  );

  const matchedGroup =
    currentGroup &&
    currentGroup.personas.length === selectedUsernames.length &&
    currentGroup.personas.every((u) => selectedUsernames.includes(u))
      ? currentGroup
      : null;

  // Live duplicate hint: trim + lowercase + exclude the current group's own
  // name (renaming a group to its own value shouldn't flag). Mirrors the API
  // check in lib/groups.ts so users see the same rule client-side.
  const trimmedNameInput = nameInput.trim();
  const nameAlreadyTaken =
    trimmedNameInput.length > 0 &&
    existingNames.some(
      (g) =>
        g.id !== matchedGroup?.id &&
        g.name.trim().toLowerCase() === trimmedNameInput.toLowerCase(),
    );

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
        router.replace(`/compare?${params.toString()}`);
        router.refresh();
      }
    } catch {
      // fetchJson already surfaced a toast
    } finally {
      setSavingName(false);
    }
  }

  async function add(username: string) {
    // When an active roundtable conversation exists, sync the participant
    // change to the server before updating the URL — this is the core fix
    // for the "couldn't save the roundtable" bug: no key forking, no
    // carry-over of message IDs, just an INSERT into conversation_participants.
    if (conversationId && mode === 'roundtable') {
      try {
        await fetchJson(`/api/conversations/${conversationId}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
          onErrorMessage: "Couldn't add this persona to the roundtable.",
        });
      } catch {
        return;
      }
    }
    writeUrl([...selectedUsernames, username], mode);
  }

  async function remove(username: string) {
    if (conversationId && mode === 'roundtable') {
      try {
        await fetchJson(
          `/api/conversations/${conversationId}/participants?username=${encodeURIComponent(username)}`,
          {
            method: 'DELETE',
            onErrorMessage: "Couldn't remove this persona from the roundtable.",
          },
        );
      } catch {
        return;
      }
    }
    writeUrl(
      selectedUsernames.filter((u) => u !== username),
      mode,
    );
  }

  function setMode(next: Mode) {
    writeUrl(selectedUsernames, next);
  }

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
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
              <form
                onSubmit={saveGroupName}
                className="flex flex-wrap items-center gap-1.5"
                aria-describedby={nameAlreadyTaken ? 'group-name-hint' : undefined}
              >
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
                  aria-invalid={nameAlreadyTaken || undefined}
                  className={`rounded-full border bg-white px-2.5 py-1 text-xs text-[var(--ink)] outline-none ${
                    nameAlreadyTaken
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-[var(--line)] focus:border-[var(--ink)]'
                  }`}
                />
                <button
                  type="submit"
                  disabled={!nameInput.trim() || savingName || nameAlreadyTaken}
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
                {nameAlreadyTaken && (
                  <span
                    id="group-name-hint"
                    className="basis-full text-[11px] text-red-600"
                  >
                    Already taken by another group.
                  </span>
                )}
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

      <ParticipantsBar
        selected={selected}
        available={available}
        onAdd={add}
        onRemove={remove}
      />

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
            conversationId={conversationId}
            onConversationCreated={(id) =>
              writeUrl(selectedUsernames, mode, { conversationId: id })
            }
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
          className="mx-auto flex max-w-[960px] items-center gap-2 rounded-[28px] border border-[var(--line)] bg-white px-2 py-2 shadow-[var(--shadow-sm)]"
        >
          <ChatInput
            ref={inputRef}
            autoFocus
            value={input}
            onChange={setInput}
            onSubmit={onSubmit}
            disableSubmit={!input.trim() || selected.length === 0}
            placeholder={placeholder}
            aria-label="Message the roundtable"
          />
          <button
            type="submit"
            disabled={!input.trim() || selected.length === 0}
            className="self-end rounded-full bg-[var(--ink)] px-4 py-2 font-display text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
