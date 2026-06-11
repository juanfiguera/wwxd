import { PersonaAvatar } from './persona-avatar';

export type BrandMarkProps = {
  size?: number;
  className?: string;
};

/** wwxd brand mark — the orange-bumps mascot + wordmark. */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <span
      className={`group inline-flex items-center gap-2 font-display font-extrabold tracking-tight text-[var(--ink)] ${className ?? ''}`}
      style={{ fontSize: size * 0.82, letterSpacing: '-0.04em' }}
    >
      <span className="wwxd-bob wwxd-tilt-on-hover">
        <PersonaAvatar color="#f1592b" crown="bumps" size={size} eyeColor="#ffffff" />
      </span>
      wwxd
    </span>
  );
}
