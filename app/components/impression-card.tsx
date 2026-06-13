/**
 * Small disclaimer note pinned to the top of every conversation thread.
 * One moment of full explicitness about what wwxd actually is, so the
 * smaller AI badges later in the thread land as a reminder, not a reveal.
 *
 * Renders as the first item in the message list, not as an overlay or
 * modal — it scrolls away as the conversation grows.
 *
 * Mode awareness: for grounded personas we point at the ↗ citations as
 * source-material the user can verify. For prior-only personas (model
 * draws from training knowledge, no curated corpus) we replace that
 * promise with an honest "no citations" framing. Mixed roundtables get
 * a hybrid sentence.
 */

type Persona = {
  username: string;
  displayName: string;
  mode?: 'grounded' | 'prior-only';
};

export function ImpressionCard({
  kind,
  personas,
}: {
  kind: 'solo' | 'roundtable';
  personas: Persona[];
}) {
  const names =
    personas.length === 1
      ? personas[0]!.displayName
      : personas.length === 2
        ? `${personas[0]!.displayName} and ${personas[1]!.displayName}`
        : `${personas
            .slice(0, -1)
            .map((p) => p.displayName)
            .join(', ')}, and ${personas[personas.length - 1]!.displayName}`;
  const plural = personas.length > 1;
  const allPriorOnly = personas.every((p) => p.mode === 'prior-only');
  const anyPriorOnly = personas.some((p) => p.mode === 'prior-only');

  const provenance = allPriorOnly
    ? "drawn from the model's general knowledge of them"
    : anyPriorOnly
      ? "some trained on their public writing, others drawn from the model's general knowledge"
      : 'trained on their public writing';

  const verifyHint = allPriorOnly
    ? 'No citations to verify, so treat replies as informed guesses.'
    : anyPriorOnly
      ? 'Look for the ↗ links where source material exists.'
      : 'The ↗ links go to source material you can verify.';

  return (
    <aside
      role="note"
      aria-label="About AI impressions"
      className="mx-auto flex max-w-[960px] items-start gap-3 rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white/60 p-3.5 text-[14.5px] leading-[1.5] text-[var(--ink-soft)]"
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </span>
      <p className="min-w-0">
        <span className="font-display font-bold text-[var(--ink-2)]">
          {kind === 'roundtable' ? 'AI roundtable.' : 'AI impression.'}
        </span>{' '}
        You&apos;re chatting with an AI rendition of{' '}
        <span className="font-display font-bold text-[var(--ink-2)]">{names}</span>, {provenance}{' '}
        — not the real {plural ? 'people' : 'person'}. Replies can misrepresent their views.{' '}
        {verifyHint}
      </p>
    </aside>
  );
}
