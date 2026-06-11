/**
 * Tiny "Cited" pill shown next to grounded persona names. Signals that this
 * persona has a curated corpus and replies will cite back to specific
 * tweets / essays / transcripts.
 *
 * Prior-only personas (no corpus, model-prior-only replies) intentionally
 * get *no* badge — we don't want to stigmatize them, and the default state
 * for a freshly-created prior-only persona reads cleaner without a negative
 * marker. The positive "Cited" badge advertises the higher-fidelity
 * experience grounded personas offer.
 */
export function CitedBadge({
  size = 'sm',
  tone,
}: {
  size?: 'sm' | 'xs';
  tone?: string;
}) {
  const px = size === 'xs' ? 'px-1.5' : 'px-2';
  const py = size === 'xs' ? 'py-[1px]' : 'py-[2px]';
  const text = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  return (
    <span
      title="Replies cite back to specific tweets, essays, or transcripts in this persona's corpus."
      className={`inline-flex items-center rounded-full border border-current font-display ${text} font-bold uppercase tracking-[0.08em] ${px} ${py} align-middle`}
      style={{
        color: tone ?? 'var(--c-green, #17a44e)',
        opacity: 0.85,
      }}
    >
      Cited
    </span>
  );
}
