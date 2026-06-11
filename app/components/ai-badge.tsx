/**
 * Tiny "AI" pill that sits next to persona names in chat surfaces. Always
 * visible, never bold, never alarming — the goal is a calm always-present
 * cue that this is an AI impression, not the real person.
 */
export function AIBadge({
  size = 'sm',
  tone,
}: {
  size?: 'sm' | 'xs';
  /** Optional accent color (typically the persona color). Defaults to a
   *  neutral grey so it doesn't fight with bolder UI. */
  tone?: string;
}) {
  const px = size === 'xs' ? 'px-1.5' : 'px-2';
  const py = size === 'xs' ? 'py-[1px]' : 'py-[2px]';
  const text = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  return (
    <span
      title="AI-generated impression, not the real person."
      className={`inline-flex items-center rounded-full border border-current font-display ${text} font-bold uppercase tracking-[0.08em] ${px} ${py} align-middle`}
      style={{
        color: tone ?? 'var(--ink-faint)',
        opacity: 0.85,
      }}
    >
      AI
    </span>
  );
}
