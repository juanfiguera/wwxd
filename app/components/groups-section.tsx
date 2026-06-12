'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PersonaAvatar } from './persona-avatar';
import type { PersonaSummary } from './persona-list';
import { personaStyle, tintHex } from '@/lib/persona-styling';

export type GroupSummary = {
  id: string;
  name: string;
  personas: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * If a roundtable conversation with this exact lineup already exists,
   * clicking the group resumes the most recent one. Server-built by the
   * home page from listConversations() output.
   */
  latestConversationId?: string;
};

export function GroupsSection({
  groups,
  personas,
}: {
  groups: GroupSummary[];
  personas: PersonaSummary[];
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Two-click delete: first click arms (red icon, "click again to confirm"),
  // second click within 3s actually deletes. Matches the rail's pattern, no
  // browser dialog.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameByUsername = new Map(personas.map((p) => [p.username, p.displayName]));

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  async function onDelete(id: string) {
    if (deletingId) return;
    if (confirmingId !== id) {
      setConfirmingId(id);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingId((curr) => (curr === id ? null : curr));
      }, 3000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingId(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  if (groups.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
        Groups
      </h2>
      <ul className="space-y-2">
        {groups.map((g) => {
          const members = g.personas.map((u) => ({
            username: u,
            displayName: nameByUsername.get(u),
          }));
          const missing = members.filter((m) => !m.displayName);
          const found = members.filter((m) => m.displayName);
          const qsParams = new URLSearchParams({
            personas: g.personas.join(','),
            group: g.id,
            mode: 'roundtable',
          });
          if (g.latestConversationId) {
            qsParams.set('conversation', g.latestConversationId);
          }
          const qs = qsParams.toString();
          const memberPreview = g.personas.slice(0, 4);
          return (
            <li
              key={g.id}
              className="flex items-center gap-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-3 transition hover:border-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
            >
              <Link href={`/compare?${qs}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex shrink-0">
                  {memberPreview.map((u, i) => {
                    const s = personaStyle(u);
                    return (
                      <span
                        key={u}
                        className="flex h-8 w-8 items-end justify-center overflow-hidden rounded-full"
                        style={{
                          background: tintHex(s.color, 0.16),
                          marginLeft: i === 0 ? 0 : -12,
                          boxShadow: '0 0 0 2.5px #fff',
                        }}
                      >
                        <span className="wwxd-bob" data-phase={(i % 4).toString()}>
                          <PersonaAvatar color={s.color} crown={s.crown} size={28} eyeColor="#fff" />
                        </span>
                      </span>
                    );
                  })}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[15px] font-bold text-[var(--ink)]">
                    {g.name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-[var(--ink-soft)]">
                    {found.length === 0 ? (
                      <span className="italic">no members available</span>
                    ) : (
                      found.map((m, i) => (
                        <span key={m.username}>
                          {m.displayName}
                          {i < found.length - 1 ? ',' : ''}
                        </span>
                      ))
                    )}
                    {missing.length > 0 && (
                      <span className="text-amber-600">({missing.length} missing)</span>
                    )}
                  </div>
                </div>
              </Link>
              <button
                onClick={() => onDelete(g.id)}
                disabled={deletingId === g.id}
                aria-label={
                  confirmingId === g.id
                    ? `Click again to delete ${g.name}`
                    : `Delete ${g.name}`
                }
                title={
                  confirmingId === g.id
                    ? `Click again to delete ${g.name}`
                    : `Delete ${g.name}`
                }
                className={
                  confirmingId === g.id
                    ? 'shrink-0 rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white transition disabled:opacity-50'
                    : 'shrink-0 rounded-full p-1.5 text-xs text-[var(--ink-soft)] transition hover:bg-[var(--paper-2)] hover:text-red-600 disabled:opacity-50'
                }
              >
                {deletingId === g.id
                  ? '...'
                  : confirmingId === g.id
                    ? 'delete?'
                    : '✕'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
