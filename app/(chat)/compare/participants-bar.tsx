'use client';

import { useEffect, useRef, useState } from 'react';
import { CitedBadge } from '@/app/components/cited-badge';
import { PersonaAvatar } from '@/app/components/persona-avatar';
import { personaStyle, tintHex } from '@/lib/persona-styling';
import type { PersonaSummary } from './compare';

/**
 * Persona chip strip + "+ add persona" picker for the compare/roundtable
 * page. Self-contained: owns the picker's open/close state and click-outside
 * + Escape handling. Parent passes the selected and available lists plus
 * add/remove callbacks.
 */
export function ParticipantsBar({
  selected,
  available,
  onAdd,
  onRemove,
}: {
  selected: PersonaSummary[];
  available: PersonaSummary[];
  onAdd: (username: string) => void;
  onRemove: (username: string) => void;
}) {
  // Picker auto-opens when there's nothing selected so the empty surface
  // doesn't feel useless — your first move is to add a persona anyway.
  const [pickerOpen, setPickerOpen] = useState(selected.length === 0);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent): void {
      const el = pickerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  return (
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
              onClick={() => onRemove(p.username)}
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
                    onClick={() => {
                      onAdd(p.username);
                      setPickerOpen(false);
                    }}
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
  );
}
