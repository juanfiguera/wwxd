'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { CitedBadge } from './cited-badge';
import { fetchJson } from './fetch-utils';
import { PersonaAvatar } from './persona-avatar';
import { PullProgress } from './pull-progress';
import { usePullJob } from './use-pull-job';
import { RelativeTime } from './relative-time';
import { toast } from './toast';
import { personaStyle, tintHex } from '@/lib/persona-styling';

export type PersonaSummary = {
  username: string;
  displayName: string;
  tweetCount: number;
  fetchedAt: string;
  hasEmbeddings: boolean;
  /**
   * 'grounded' (default, also `undefined` for legacy corpora) means the
   * persona has curated sources and replies cite back to them. 'prior-only'
   * means the persona was created without ingestion — replies come from
   * the model's training knowledge of the named person, no citations.
   */
  mode?: 'grounded' | 'prior-only';
};

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function PersonaCard({
  persona,
  isSelected,
  onToggleGroup,
}: {
  persona: PersonaSummary;
  isSelected: boolean;
  onToggleGroup: () => void;
}) {
  const router = useRouter();
  const { status, start, reset } = usePullJob();
  const isPulling = status.state === 'running';
  const style = personaStyle(persona.username);

  const [showSources, setShowSources] = useState(false);
  const [essayRss, setEssayRss] = useState('');
  const [essaySitemap, setEssaySitemap] = useState('');
  const [essayUrlsRaw, setEssayUrlsRaw] = useState('');
  const [youtubeUrlsRaw, setYoutubeUrlsRaw] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    const ok = window.confirm(
      `Delete ${persona.displayName} (@${persona.username})?\n\nThis removes the tweet corpus, embeddings, solo chat history, and removes them from any groups. Roundtable conversations they participated in are kept as a historical record.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await fetchJson(`/api/personas/${encodeURIComponent(persona.username)}`, {
        method: 'DELETE',
        onErrorMessage: `Couldn't delete ${persona.displayName}.`,
      });
      toast.success(`Deleted ${persona.displayName}.`);
      router.refresh();
    } catch {
      setDeleting(false);
    }
  }

  async function onSubmitSources(e: React.FormEvent) {
    e.preventDefault();
    if (isPulling) return;
    const essayUrls = splitLines(essayUrlsRaw);
    const youtubeUrls = splitLines(youtubeUrlsRaw);
    const rss = essayRss.trim();
    const sitemap = essaySitemap.trim();
    if (!rss && !sitemap && essayUrls.length === 0 && youtubeUrls.length === 0) return;

    await start(persona.username, {
      mode: 'skip',
      essayRss: rss || undefined,
      essaySitemap: sitemap || undefined,
      essayUrls,
      youtubeUrls,
    });
    setShowSources(false);
    setEssayRss('');
    setEssaySitemap('');
    setEssayUrlsRaw('');
    setYoutubeUrlsRaw('');
  }

  return (
    <li
      className={`overflow-hidden rounded-[var(--r-lg)] border bg-white transition ${
        isSelected
          ? 'border-[var(--ink)] ring-1 ring-[var(--ink)]'
          : 'border-[var(--line)] hover:border-[var(--ink)] hover:shadow-[var(--shadow-sm)]'
      }`}
      style={isSelected ? { '--cv': style.color } as React.CSSProperties : undefined}
    >
      <div className="relative">
        <Link
          href={`/${persona.username}`}
          className="block p-4 pr-56 hover:bg-[var(--paper-2)]/40"
        >
          <div className="flex items-center gap-3">
            <span
              className="flex shrink-0 items-end justify-center overflow-hidden rounded-full"
              style={{
                width: 48,
                height: 48,
                background: tintHex(style.color, 0.16),
              }}
            >
              <span
                className="wwxd-bob"
                data-phase={(persona.username.charCodeAt(0) % 4).toString()}
              >
                <PersonaAvatar
                  color={style.color}
                  crown={style.crown}
                  size={44}
                  eyeColor="#ffffff"
                />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-1.5 font-display text-[15.5px] font-bold text-[var(--ink)]">
                  {persona.displayName}
                  {persona.mode !== 'prior-only' && <CitedBadge size="xs" />}
                </span>
                <span className="text-xs text-[var(--ink-soft)]">@{persona.username}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-soft)]">
                {persona.mode === 'prior-only' ? (
                  <span>from memory · no curated sources</span>
                ) : (
                  <>
                    <span>{persona.tweetCount.toLocaleString()} tweets</span>
                    <span>•</span>
                    <span>{persona.hasEmbeddings ? 'embeddings ready' : 'no embeddings'}</span>
                  </>
                )}
                {persona.fetchedAt && (
                  <>
                    <span>•</span>
                    <span>
                      {persona.mode === 'prior-only' ? 'created' : 'updated'}{' '}
                      <RelativeTime iso={persona.fetchedAt} />
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Link>

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          <button
            onClick={onDelete}
            disabled={deleting}
            title={`Delete ${persona.displayName}`}
            aria-label={`Delete ${persona.displayName}`}
            className="rounded-full border border-[var(--line)] p-1.5 text-[var(--ink-soft)] transition hover:border-red-500 hover:text-red-600 disabled:opacity-50"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button
            onClick={() => start(persona.username, { mode: 'deep' })}
            disabled={isPulling}
            title="Pull more tweets (deep)"
            aria-label={`Pull more tweets for ${persona.displayName}`}
            className="rounded-full border border-[var(--line)] p-1.5 text-[var(--ink-soft)] transition hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            <span className={isPulling ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
          </button>
          <button
            onClick={() => setShowSources((v) => !v)}
            disabled={isPulling}
            title="Add essays or YouTube transcripts"
            aria-pressed={showSources}
            className={`rounded-full px-2.5 py-1 font-display text-xs font-bold transition ${
              showSources
                ? 'bg-[var(--paper-2)] text-[var(--ink)]'
                : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink)] hover:text-[var(--ink)]'
            }`}
          >
            + src
          </button>
          <button
            onClick={onToggleGroup}
            aria-pressed={isSelected}
            className={`rounded-full px-3 py-1 font-display text-xs font-bold transition ${
              isSelected
                ? 'bg-[var(--ink)] text-white'
                : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink)] hover:text-[var(--ink)]'
            }`}
          >
            {isSelected ? '✓ in group' : '+ group'}
          </button>
        </div>
      </div>

      {showSources && status.state === 'idle' && (
        <form
          onSubmit={onSubmitSources}
          className="border-t border-[var(--line)] bg-[var(--paper-2)] p-3"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="url"
              value={essayRss}
              onChange={(e) => setEssayRss(e.target.value)}
              placeholder="essay RSS feed (optional)"
              className="rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            />
            <input
              type="url"
              value={essaySitemap}
              onChange={(e) => setEssaySitemap(e.target.value)}
              placeholder="essay sitemap (optional)"
              className="rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            />
            <textarea
              value={essayUrlsRaw}
              onChange={(e) => setEssayUrlsRaw(e.target.value)}
              placeholder="essay URLs, one per line"
              rows={2}
              className="rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            />
            <textarea
              value={youtubeUrlsRaw}
              onChange={(e) => setYoutubeUrlsRaw(e.target.value)}
              placeholder="YouTube URLs or IDs, one per line"
              rows={2}
              className="rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            />
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSources(false)}
              className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
            >
              cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-[var(--ink)] px-3 py-1.5 font-display text-xs font-bold text-white"
            >
              add sources
            </button>
          </div>
        </form>
      )}

      {status.state !== 'idle' && (
        <div className="border-t border-[var(--line)] bg-[var(--paper-2)] p-3">
          <PullProgress status={status} onDismiss={reset} />
        </div>
      )}
    </li>
  );
}

export function PersonaList({ personas }: { personas: PersonaSummary[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get('selected') ?? '';

  const selectedUsernames = useMemo(
    () =>
      selectedParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [selectedParam],
  );
  const selectedSet = useMemo(() => new Set(selectedUsernames), [selectedUsernames]);

  const updateSelection = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next.length > 0) params.set('selected', next.join(','));
      else params.delete('selected');
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : '/', { scroll: false });
    },
    [router, searchParams],
  );

  const toggle = useCallback(
    (username: string) => {
      if (selectedSet.has(username)) {
        updateSelection(selectedUsernames.filter((u) => u !== username));
      } else {
        updateSelection([...selectedUsernames, username]);
      }
    },
    [selectedSet, selectedUsernames, updateSelection],
  );

  const clear = useCallback(() => updateSelection([]), [updateSelection]);

  const [savingGroup, setSavingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const groupHref = useMemo(() => {
    if (selectedUsernames.length === 0) return '/compare';
    const qs = new URLSearchParams({ personas: selectedUsernames.join(',') }).toString();
    return `/compare?${qs}`;
  }, [selectedUsernames]);

  async function onSaveGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = groupName.trim();
    if (!name || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fetchJson('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, personas: selectedUsernames }),
        onErrorMessage: "Couldn't save this group.",
      });
      toast.success(`Saved “${name}”.`);
      setSavingGroup(false);
      setGroupName('');
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function cancelSave() {
    setSavingGroup(false);
    setGroupName('');
    setSaveError(null);
  }

  if (personas.length === 0) {
    return (
      <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-8 text-sm text-[var(--ink-soft)]">
        <p className="font-display font-extrabold text-[var(--ink)]">No personas yet.</p>
        <p className="mt-2">Add one above to get started.</p>
      </div>
    );
  }

  const selectedPersonas = selectedUsernames
    .map((u) => personas.find((p) => p.username === u))
    .filter((p): p is PersonaSummary => Boolean(p));

  return (
    <>
      <ul className="space-y-3 pb-24">
        {personas.map((p) => (
          <PersonaCard
            key={p.username}
            persona={p}
            isSelected={selectedSet.has(p.username)}
            onToggleGroup={() => toggle(p.username)}
          />
        ))}
      </ul>

      {selectedPersonas.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
            <span className="font-display text-xs font-bold text-[var(--ink-soft)]">
              Group ({selectedPersonas.length}):
            </span>
            {selectedPersonas.map((p) => (
              <span
                key={p.username}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3 py-1 font-display text-xs font-bold text-white"
              >
                {p.displayName}
                <button
                  onClick={() => toggle(p.username)}
                  className="opacity-60 hover:opacity-100"
                  aria-label={`Remove ${p.displayName}`}
                >
                  ✕
                </button>
              </span>
            ))}
            {savingGroup ? (
              <form onSubmit={onSaveGroup} className="ml-auto flex items-center gap-2">
                <input
                  autoFocus
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="group name"
                  className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                  maxLength={60}
                />
                <button
                  type="submit"
                  disabled={!groupName.trim() || saving}
                  className="rounded-full bg-[var(--ink)] px-3 py-1 font-display text-xs font-bold text-white disabled:opacity-50"
                >
                  {saving ? 'saving...' : 'save'}
                </button>
                <button
                  type="button"
                  onClick={cancelSave}
                  className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
                >
                  cancel
                </button>
              </form>
            ) : (
              <div className="ml-auto flex items-center gap-3">
                <button
                  onClick={clear}
                  className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
                >
                  clear
                </button>
                <button
                  onClick={() => setSavingGroup(true)}
                  className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
                >
                  + save as group
                </button>
                <Link
                  href={groupHref}
                  className="rounded-full bg-[var(--ink)] px-3 py-1.5 font-display text-xs font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)]"
                >
                  Open group chat →
                </Link>
              </div>
            )}
          </div>
          {saveError && (
            <div className="mx-auto max-w-3xl px-4 pb-2 text-xs text-red-600">{saveError}</div>
          )}
        </div>
      )}
    </>
  );
}
