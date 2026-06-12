'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from './brand-mark';
import { fetchJson } from './fetch-utils';
import { PersonaAvatar } from './persona-avatar';
import { PullProgress } from './pull-progress';
import { RelativeTime } from './relative-time';
import { toast } from './toast';
import { usePullJob } from './use-pull-job';
import { personaStyle, tintHex } from '@/lib/persona-styling';

export type RailPersona = {
  username: string;
  displayName: string;
  tweetCount: number;
  fetchedAt: string;
  accent: string;
};

export type RailGroup = {
  id: string;
  name: string;
  personas: string[];
  /** Display names parallel to `personas`. Used in hover tooltip. */
  personaDisplayNames?: string[];
  accent: string;
};

export type RailConv = {
  kind: 'solo' | 'roundtable' | 'group';
  key: string;
  displayName: string;
  members: string[];
  /** Display names parallel to `members`. Used in hover tooltip. */
  memberDisplayNames?: string[];
  /** When kind === 'group', the ID of the saved Group. */
  groupId?: string;
  messageCount: number;
  updatedAt: string;
  accent: string;
};

function Disc({ username, size = 30 }: { username: string; size?: number }) {
  const s = personaStyle(username);
  return (
    <span
      className="flex items-end justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: tintHex(s.color, 0.16),
        boxShadow: 'inset 0 0 0 1.5px rgba(20,18,10,0.05)',
      }}
    >
      <PersonaAvatar
        color={s.color}
        crown={s.crown}
        size={Math.round(size * 0.92)}
        eyeColor="#fff"
      />
    </span>
  );
}

function MemberStack({ usernames }: { usernames: string[] }) {
  return (
    <span className="flex shrink-0 items-center">
      {usernames.slice(0, 3).map((u, i) => (
        <span
          key={u}
          style={{
            marginLeft: i === 0 ? 0 : -13,
            boxShadow: '0 0 0 2.5px var(--rail)',
            borderRadius: '999px',
          }}
        >
          <Disc username={u} size={30} />
        </span>
      ))}
    </span>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1.5 pt-3.5 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
      <span>{label}</span>
      <span className="text-[11px] tracking-[0.04em]">{count}</span>
    </div>
  );
}

function groupHref(g: RailGroup): string {
  const qs = new URLSearchParams({
    personas: g.personas.join(','),
    group: g.id,
    mode: 'roundtable',
  }).toString();
  return `/compare?${qs}`;
}

function PlainRow({
  href,
  active,
  accent,
  avatar,
  name,
  preview,
  memberUsernames,
  memberDisplayNames,
  onDelete,
  deleteLabel,
  isDeleting,
  isConfirmingDelete,
}: {
  href: string;
  active: boolean;
  accent: string;
  avatar: React.ReactNode;
  name: string;
  preview: React.ReactNode;
  /** Optional: when present, hovering the row swaps the preview line to show
   *  member display names instead of "N messages · ago". */
  memberUsernames?: string[];
  memberDisplayNames?: string[];
  /** Optional: when provided, render a small trash button visible on hover.
   *  The handler runs with a fresh MouseEvent so it can prevent the Link nav.
   *  First click should "arm" the row (pass isConfirmingDelete=true on the
   *  next render); second click within the parent's timeout deletes. */
  onDelete?: () => void;
  deleteLabel?: string;
  isDeleting?: boolean;
  isConfirmingDelete?: boolean;
}) {
  const hasMembers = !!memberUsernames && memberUsernames.length > 0;
  const memberNames = hasMembers
    ? (memberDisplayNames ?? memberUsernames).join(', ')
    : null;
  const titleAttr = memberNames ?? undefined;
  return (
    <Link
      href={href}
      title={titleAttr}
      className={`group/row relative flex items-center gap-3 rounded-[13px] px-2.5 py-2 transition ${
        active ? 'bg-white shadow-[var(--shadow-sm)]' : 'hover:bg-[var(--line-2)]'
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-2.5 top-1/2 h-[22px] w-1 -translate-y-1/2 rounded-full"
          style={{ background: accent }}
        />
      )}
      <span className="shrink-0">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14.5px] font-bold text-[var(--ink)]">
          {name}
        </span>
        <span className="relative block h-[16px] overflow-hidden text-[12.5px] text-[var(--ink-soft)]">
          <span
            className={`absolute inset-0 truncate transition-opacity duration-150 ${
              hasMembers ? 'group-hover/row:opacity-0' : ''
            } ${onDelete ? 'group-hover/row:pr-7' : ''}`}
          >
            {preview}
          </span>
          {hasMembers && (
            <span
              className={`absolute inset-0 truncate font-medium text-[var(--ink)] opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 ${
                onDelete ? 'group-hover/row:pr-7' : ''
              }`}
              aria-hidden
            >
              {memberNames}
            </span>
          )}
        </span>
      </span>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          disabled={isDeleting}
          aria-label={deleteLabel ?? 'Delete'}
          title={deleteLabel ?? 'Delete'}
          // When armed (isConfirmingDelete), the button stays visible
          // regardless of hover and turns red. Second click within the
          // parent's timeout completes the delete.
          className={
            isConfirmingDelete
              ? 'absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white opacity-100 transition disabled:opacity-30'
              : 'absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink-faint)] opacity-0 transition group-hover/row:opacity-100 hover:bg-[var(--paper-2)] hover:text-red-600 disabled:opacity-30'
          }
        >
          {isDeleting ? (
            <span className="text-[10px]">...</span>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 6h18" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          )}
        </button>
      )}
    </Link>
  );
}

function PersonaRow({
  persona,
  active,
}: {
  persona: RailPersona;
  active: boolean;
}) {
  const router = useRouter();
  const { status, start, reset } = usePullJob();
  const isPulling = status.state === 'running';
  const [deleting, setDeleting] = useState(false);

  function onRefresh() {
    start(persona.username, { mode: 'deep' });
  }

  async function onDelete() {
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
      // If we were viewing this persona's chat, go home.
      if (window.location.pathname === `/${persona.username}`) {
        router.push('/');
      }
      router.refresh();
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div
        className={`group/row relative rounded-[13px] transition ${
          active ? 'bg-white shadow-[var(--shadow-sm)]' : 'hover:bg-[var(--line-2)]'
        }`}
      >
        {active && (
          <span
            aria-hidden
            className="pointer-events-none absolute -left-2.5 top-1/2 h-[22px] w-1 -translate-y-1/2 rounded-full"
            style={{ background: persona.accent }}
          />
        )}
        {/* Stretched link — covers the row except where buttons sit on top */}
        <Link
          href={`/${persona.username}`}
          aria-label={persona.displayName}
          className="absolute inset-0 rounded-[13px]"
        />
        {/* Row content (visual only — clicks pass through to the link) */}
        <div className="pointer-events-none relative flex items-center gap-3 px-2.5 py-2">
          <span className="shrink-0">
            <Disc username={persona.username} size={38} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate font-display text-[14.5px] font-bold text-[var(--ink)]">
                {persona.displayName}
              </span>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                title={`Delete ${persona.displayName}`}
                aria-label={`Delete ${persona.displayName}`}
                className="pointer-events-auto relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] opacity-100 transition hover:bg-white hover:text-red-600 hover:shadow-[var(--shadow-sm)] focus:opacity-100 disabled:opacity-50 md:opacity-0 md:group-hover/row:opacity-100"
              >
                <svg
                  width="12"
                  height="12"
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
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate text-[12.5px] text-[var(--ink-soft)]">
                {persona.tweetCount.toLocaleString()} tweets
                {persona.fetchedAt && (
                  <>
                    {' · updated '}
                    <RelativeTime iso={persona.fetchedAt} />
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={isPulling}
                title={isPulling ? 'Refreshing...' : 'Refresh tweets'}
                aria-label={`Refresh tweets for ${persona.displayName}`}
                className="pointer-events-auto relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-white hover:text-[var(--ink)] hover:shadow-[var(--shadow-sm)] disabled:opacity-50"
              >
                <span
                  className={
                    isPulling
                      ? 'inline-block animate-spin text-[13px]'
                      : 'inline-block text-[13px]'
                  }
                >
                  ↻
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {status.state !== 'idle' && (
        <div className="mx-1 my-1 rounded-[var(--r)] bg-white/60 p-2">
          <PullProgress status={status} onDismiss={reset} />
        </div>
      )}
    </div>
  );
}

export function ChatRailClient({
  personas,
  groups,
  recent,
}: {
  personas: RailPersona[];
  groups: RailGroup[];
  recent: RailConv[];
}) {
  const pathname = usePathname();
  // Solo persona route is now `/<slug>`. Reserved top-level segments are
  // built-in pages, not personas, so exclude them from this match.
  const RESERVED_SEGMENTS = new Set(['compare', 'evals', 'settings', 'api']);
  const soloMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)$/)?.[1] ?? null;
  const activeSolo = soloMatch && !RESERVED_SEGMENTS.has(soloMatch) ? soloMatch : null;

  // search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Optimistic delete tracking for recent conversations: keep the row hidden
  // locally as soon as the request 2xxs (router.refresh re-renders the rail
  // shortly after, but the row would briefly reappear without this).
  const [deletingConv, setDeletingConv] = useState<string | null>(null);
  const [hiddenConvIds, setHiddenConvIds] = useState<Set<string>>(new Set());
  // Two-click delete: first click on the trash arms the row (red icon + label),
  // a second click within a few seconds actually deletes. No browser confirm
  // dialog — matches the wwxd minimal aesthetic and removes the double-OK
  // weirdness of window.confirm() inside a Link descendant.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Global "/" shortcut to open search, "Esc" to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (!searchOpen && e.key === '/' && !inField) {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (searchOpen && e.key === 'Escape') {
        e.preventDefault();
        setSearchOpen(false);
        setQuery('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  const q = query.trim().toLowerCase();
  const filterable = q.length > 0;

  const visiblePersonas = useMemo(
    () =>
      filterable
        ? personas.filter(
            (p) =>
              p.displayName.toLowerCase().includes(q) ||
              p.username.toLowerCase().includes(q),
          )
        : personas,
    [personas, q, filterable],
  );
  const visibleGroups = useMemo(
    () =>
      filterable ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups,
    [groups, q, filterable],
  );
  const visibleRecent = useMemo(
    () =>
      (filterable
        ? recent.filter(
            (r) =>
              r.displayName.toLowerCase().includes(q) ||
              r.key.toLowerCase().includes(q),
          )
        : recent
      ).filter((r) => !hiddenConvIds.has(r.key)),
    [recent, q, filterable, hiddenConvIds],
  );

  function armDeleteConfirm(convId: string): void {
    setConfirmingDelete(convId);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingDelete((curr) => (curr === convId ? null : curr));
    }, 3000);
  }

  async function deleteConversation(convId: string): Promise<void> {
    if (deletingConv) return;
    // First click on the trash arms the row; second click within 3s deletes.
    if (confirmingDelete !== convId) {
      armDeleteConfirm(convId);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDelete(null);
    setDeletingConv(convId);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setHiddenConvIds((prev) => {
          const next = new Set(prev);
          next.add(convId);
          return next;
        });
        router.refresh();
      }
    } finally {
      setDeletingConv(null);
    }
  }

  const noResults =
    filterable &&
    visiblePersonas.length === 0 &&
    visibleGroups.length === 0 &&
    visibleRecent.length === 0;

  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col bg-[var(--rail)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        {searchOpen ? (
          <>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)]"
            />
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              aria-label="Close search"
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[var(--ink-soft)] hover:bg-[var(--line-2)] hover:text-[var(--ink)]"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <Link href="/" className="shrink-0">
              <BrandMark size={26} />
            </Link>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              title="Search ( / )"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[var(--ink-soft)] transition hover:bg-[var(--line-2)] hover:text-[var(--ink)]"
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4-4" />
              </svg>
            </button>
          </>
        )}
      </div>

      <Link
        href="/"
        className="mx-3.5 mt-1 flex items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2.5 font-display text-[14px] font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)]"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New conversation
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4 pt-2">
        {noResults && (
          <div className="px-2.5 py-8 text-center text-xs text-[var(--ink-soft)]">
            No matches for &quot;{query}&quot;.
          </div>
        )}

        {!filterable && visibleRecent.length === 0 && (
          <div className="mx-2.5 mt-4 rounded-[var(--r)] border border-dashed border-[var(--line)] bg-white p-4 text-center text-xs text-[var(--ink-soft)]">
            <p className="font-display font-bold text-[var(--ink)]">No conversations yet.</p>
            <p className="mt-1">
              Tap <span className="font-display font-bold text-[var(--ink)]">+ New conversation</span> to start one.
            </p>
          </div>
        )}

        {visibleRecent.length > 0 && (
          <>
            <SectionLabel label="Recent" count={visibleRecent.length} />
            {visibleRecent.map((c) => {
              let href: string;
              if (c.kind === 'solo') {
                href = `/${c.members[0]}`;
              } else {
                // c.key carries the conversation's UUID for roundtables.
                // Including `conversation=<id>` is what links the rail row
                // to a stable conversation that can gain/lose participants
                // without forking.
                const params = new URLSearchParams({
                  personas: c.members.join(','),
                  mode: 'roundtable',
                  conversation: c.key,
                });
                if (c.groupId) params.set('group', c.groupId);
                href = `/compare?${params.toString()}`;
              }
              const active = c.kind === 'solo' && activeSolo === c.members[0];
              return (
                <PlainRow
                  key={`${c.kind}:${c.key}`}
                  href={href}
                  active={active}
                  accent={c.accent}
                  avatar={
                    c.kind === 'solo' ? (
                      <Disc username={c.members[0]} size={38} />
                    ) : (
                      <MemberStack usernames={c.members} />
                    )
                  }
                  name={c.displayName}
                  preview={
                    <>
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'} ·{' '}
                      <RelativeTime iso={c.updatedAt} />
                    </>
                  }
                  memberUsernames={c.kind === 'solo' ? undefined : c.members}
                  memberDisplayNames={c.kind === 'solo' ? undefined : c.memberDisplayNames}
                  onDelete={() => deleteConversation(c.key)}
                  deleteLabel={
                    confirmingDelete === c.key
                      ? `Click again to remove ${c.displayName}`
                      : `Remove ${c.displayName} from recents`
                  }
                  isDeleting={deletingConv === c.key}
                  isConfirmingDelete={confirmingDelete === c.key}
                />
              );
            })}
          </>
        )}

        {/* When searching, also surface personas + groups by name so the filter is useful */}
        {filterable && visibleGroups.length > 0 && (
          <>
            <SectionLabel label="Rooms" count={visibleGroups.length} />
            {visibleGroups.map((g) => (
              <PlainRow
                key={g.id}
                href={groupHref(g)}
                active={false}
                accent={g.accent}
                avatar={<MemberStack usernames={g.personas} />}
                name={g.name}
                preview={`${g.personas.length} personas`}
                memberUsernames={g.personas}
                memberDisplayNames={g.personaDisplayNames}
              />
            ))}
          </>
        )}
        {filterable && visiblePersonas.length > 0 && (
          <>
            <SectionLabel label="Personas" count={visiblePersonas.length} />
            {visiblePersonas.map((p) => (
              <PersonaRow
                key={p.username}
                persona={p}
                active={activeSolo === p.username}
              />
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-[var(--line)] px-3.5 py-3">
        <span className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden rounded-full">
          <PersonaAvatar color="#f1592b" crown="bumps" size={32} eyeColor="#fff" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13.5px] font-extrabold leading-tight text-[var(--ink)]">
            wwxd
          </div>
          <div className="text-[11.5px] font-semibold text-[var(--ink-soft)]">
            MIT · self-hosted
          </div>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] transition ${
            pathname.startsWith('/settings') || pathname.startsWith('/evals')
              ? 'bg-white text-[var(--ink)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--ink-soft)] hover:bg-[var(--line-2)] hover:text-[var(--ink)]'
          }`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}
