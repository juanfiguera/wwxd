import { PersonaAvatar, type Crown } from './persona-avatar';
import { tintHex } from '@/lib/persona-styling';

type Lineup = {
  color: string;
  crown: Crown;
  name: string;
};

/**
 * Preview lineup for the first-run experience. These are illustrative — they
 * disappear the moment the user adds their first real persona.
 */
const LINEUP: Lineup[] = [
  { color: '#f1592b', name: 'Garry',  crown: 'bumps' },
  { color: '#2e6bf6', name: 'Marc',   crown: 'spikes' },
  { color: '#0e9c8e', name: 'Naval',  crown: 'flat' },
  { color: '#7b5bff', name: 'Trevor', crown: 'horns' },
  { color: '#17a44e', name: 'Sam',    crown: 'flat' },
];

export function EmptyHome() {
  return (
    <div className="rounded-[var(--r-xl)] border border-[var(--line)] bg-white p-8 text-center shadow-[var(--shadow-sm)]">
      <div className="font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--c-green)]">
        ◆ Welcome
      </div>
      <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-[var(--ink)] sm:text-4xl">
        Build your first cast.
      </h2>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[var(--ink-2)]">
        Paste any X handle. We&apos;ll pull their tweets, optionally their essays and
        YouTube transcripts, then they answer in character — solo or in a roundtable.
      </p>

      <div className="relative mx-auto mt-10 mb-2 flex max-w-md items-end justify-center gap-2">
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--line) 12%, var(--line) 88%, transparent)',
          }}
        />
        {LINEUP.map((p, i) => {
          const lifted = i === 2;
          return (
            <div
              key={p.name}
              className="relative flex flex-col items-center"
              style={{
                transform: lifted ? 'translateY(-18px)' : 'translateY(0)',
                transition: 'transform 0.3s cubic-bezier(.34,1.56,.64,1)',
              }}
            >
              {lifted && (
                <span
                  className="mb-1 rounded-full border-2 border-[var(--ink)] bg-white px-3 py-1 font-display text-[11px] font-bold text-[var(--ink)] shadow-[var(--shadow-sm)]"
                >
                  Add anyone
                </span>
              )}
              <span
                className="flex items-end justify-center overflow-hidden rounded-full"
                style={{
                  width: 56,
                  height: 56,
                  background: tintHex(p.color, 0.16),
                }}
              >
                <span className="wwxd-bob" data-phase={(i % 4).toString()}>
                  <PersonaAvatar color={p.color} crown={p.crown} size={50} eyeColor="#fff" />
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-[var(--ink-soft)]">
        Try{' '}
        <code className="rounded-full bg-[var(--paper-2)] px-2 py-0.5 font-display text-[11px] font-bold text-[var(--ink)]">
          garrytan
        </code>
        ,{' '}
        <code className="rounded-full bg-[var(--paper-2)] px-2 py-0.5 font-display text-[11px] font-bold text-[var(--ink)]">
          pmarca
        </code>
        , or{' '}
        <code className="rounded-full bg-[var(--paper-2)] px-2 py-0.5 font-display text-[11px] font-bold text-[var(--ink)]">
          naval
        </code>
        .
      </p>
    </div>
  );
}
