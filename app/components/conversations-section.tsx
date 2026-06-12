'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PersonaAvatar } from './persona-avatar';
import { RelativeTime } from './relative-time';
import { personaStyle, tintHex } from '@/lib/persona-styling';

export type RecentConversation = {
  kind: 'solo' | 'roundtable';
  key: string;
  updatedAt: string;
  messageCount: number;
  // Resolved at the server: display names for the personas involved
  participants: { username: string; displayName: string }[];
};

function chatHref(conv: RecentConversation): string {
  if (conv.kind === 'solo') return `/${conv.participants[0]?.username ?? conv.key}`;
  const personas = conv.participants.map((p) => p.username).join(',');
  return `/compare?personas=${encodeURIComponent(personas)}&mode=roundtable`;
}

export function ConversationsSection({
  conversations,
}: {
  conversations: RecentConversation[];
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = conversations.filter((c) => !hidden.has(`${c.kind}:${c.key}`));
  if (visible.length === 0) return null;

  async function onDelete(conv: RecentConversation) {
    const id = `${conv.kind}:${conv.key}`;
    const label =
      conv.kind === 'solo'
        ? conv.participants[0]?.displayName ?? conv.key
        : conv.participants.map((p) => p.displayName).join(', ') || conv.key;
    if (!confirm(`Delete this conversation with ${label}?`)) return;
    setDeleting(id);
    try {
      const url = `/api/conversations?kind=${conv.kind}&key=${encodeURIComponent(conv.key)}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        setHidden((prev) => new Set(prev).add(id));
        router.refresh();
      }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
        Recent conversations
      </h2>
      <ul className="space-y-2">
        {visible.slice(0, 8).map((conv) => {
          const id = `${conv.kind}:${conv.key}`;
          const isSolo = conv.kind === 'solo';
          const label = isSolo
            ? conv.participants[0]?.displayName ?? conv.key
            : conv.participants.map((p) => p.displayName).filter(Boolean).join(', ') ||
              conv.key;
          const preview = conv.participants.slice(0, 3);
          return (
            <li
              key={id}
              className="flex items-center gap-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-3 transition hover:border-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
            >
              <Link href={chatHref(conv)} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex shrink-0">
                  {preview.map((p, i) => {
                    const s = personaStyle(p.username);
                    return (
                      <span
                        key={p.username}
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
                  <div className="flex items-baseline gap-2 truncate text-sm">
                    <span className="rounded-full bg-[var(--paper-2)] px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">
                      {isSolo ? 'solo' : 'roundtable'}
                    </span>
                    <span className="truncate font-display font-bold text-[var(--ink)]">{label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--ink-soft)]">
                    {conv.messageCount} message{conv.messageCount === 1 ? '' : 's'} ·{' '}
                    <RelativeTime iso={conv.updatedAt} />
                  </div>
                </div>
              </Link>
              <button
                onClick={() => onDelete(conv)}
                disabled={deleting === id}
                aria-label="Delete conversation"
                className="shrink-0 rounded-full p-1.5 text-xs text-[var(--ink-soft)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                {deleting === id ? '...' : '✕'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
