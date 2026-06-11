import { Fragment } from 'react';

export type Crown =
  | 'bumps'
  | 'sprout'
  | 'spikes'
  | 'antenna'
  | 'ears'
  | 'horns'
  | 'tuft'
  | 'flat';

export type EyeStyle = 'dots' | 'happy' | 'blink' | 'wide';
export type MouthStyle = 'none' | 'o' | 'smile';
export type LookDirection = 'center' | 'left' | 'right' | 'up' | 'down';

export const CROWNS: readonly Crown[] = [
  'bumps',
  'sprout',
  'spikes',
  'antenna',
  'ears',
  'horns',
  'tuft',
  'flat',
] as const;

const VIEWBOX_W = 100;
const VIEWBOX_H = 112;

const LOOK_OFFSETS: Record<LookDirection, [number, number]> = {
  center: [0, 0],
  left: [-2.4, 0],
  right: [2.4, 0],
  up: [0, -2.2],
  down: [0, 2],
};

export type PersonaAvatarProps = {
  /** Body fill color, e.g. '#F1592B'. */
  color: string;
  /** Crown shape on top of the head. */
  crown?: Crown;
  /** Render width in px. Height auto-scales (viewBox is 100×112). */
  size?: number;
  /** Pupil direction. */
  look?: LookDirection;
  /** Eye style. */
  eyes?: EyeStyle;
  /** Mouth style. */
  mouth?: MouthStyle;
  /** Eye fill. White reads best on dark bodies, dark ink on light bodies. */
  eyeColor?: string;
  /** Optional accessible label. */
  title?: string;
  /** className passthrough. */
  className?: string;
};

function CrownShape({ crown, color }: { crown: Crown; color: string }) {
  switch (crown) {
    case 'bumps':
      return (
        <>
          {[27, 44, 61, 78].map((cx) => (
            <circle key={cx} cx={cx} cy={28} r={11} fill={color} />
          ))}
        </>
      );
    case 'sprout': {
      const leaf = 'M50 28 C42 18 44 6 50 0 C56 6 58 18 50 28 Z';
      return (
        <>
          <rect x={47} y={14} width={6} height={20} rx={3} fill={color} />
          {[-46, -23, 0, 23, 46].map((a) => (
            <path key={a} d={leaf} transform={`rotate(${a} 50 28)`} fill={color} />
          ))}
        </>
      );
    }
    case 'spikes':
      return (
        <>
          {Array.from({ length: 5 }, (_, i) => {
            const x = 18 + i * 13;
            return (
              <path
                key={i}
                d={`M${x} 33 L${x + 6.5} 8 L${x + 13} 33 Z`}
                fill={color}
              />
            );
          })}
        </>
      );
    case 'antenna':
      return (
        <>
          <rect x={47} y={9} width={6} height={24} rx={3} fill={color} />
          <circle cx={50} cy={7} r={8} fill={color} />
        </>
      );
    case 'ears':
      return (
        <>
          <path d="M16 34 L22 2 L46 34 Z" fill={color} />
          <path d="M84 34 L78 2 L54 34 Z" fill={color} />
        </>
      );
    case 'horns':
      return (
        <>
          <path
            d="M24 33 C16 18 18 12 21 11 C26 10 30 22 40 33 Z"
            fill={color}
          />
          <path
            d="M76 33 C84 18 82 12 79 11 C74 10 70 22 60 33 Z"
            fill={color}
          />
        </>
      );
    case 'tuft':
      return (
        <>
          <circle cx={49} cy={22} r={11} fill={color} />
          <circle cx={63} cy={17} r={6.5} fill={color} />
        </>
      );
    case 'flat':
    default:
      return null;
  }
}

function Eyes({
  eyes,
  look,
  color,
}: {
  eyes: EyeStyle;
  look: LookDirection;
  color: string;
}) {
  const [dx, dy] = LOOK_OFFSETS[look];
  const lx = 40;
  const rx = 60;
  const ey = 60;

  if (eyes === 'happy') {
    return (
      <>
        <path
          d={`M${lx - 7} ${ey + 2} Q${lx} ${ey - 7} ${lx + 7} ${ey + 2}`}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M${rx - 7} ${ey + 2} Q${rx} ${ey - 7} ${rx + 7} ${ey + 2}`}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
      </>
    );
  }

  if (eyes === 'blink') {
    return (
      <>
        <rect x={lx - 6} y={ey - 1.5} width={12} height={4.5} rx={2.2} fill={color} />
        <rect x={rx - 6} y={ey - 1.5} width={12} height={4.5} rx={2.2} fill={color} />
      </>
    );
  }

  const r = eyes === 'wide' ? 8 : 6.4;
  return (
    <>
      <circle cx={lx + dx} cy={ey + dy} r={r} fill={color} />
      <circle cx={rx + dx} cy={ey + dy} r={r} fill={color} />
    </>
  );
}

function Mouth({ mouth, color }: { mouth: MouthStyle; color: string }) {
  if (mouth === 'o') return <ellipse cx={50} cy={76} rx={5} ry={6} fill={color} />;
  if (mouth === 'smile')
    return (
      <path
        d="M42 74 Q50 82 58 74"
        stroke={color}
        strokeWidth={4.4}
        fill="none"
        strokeLinecap="round"
      />
    );
  return null;
}

export function PersonaAvatar({
  color,
  crown = 'bumps',
  size = 120,
  look = 'center',
  eyes = 'dots',
  mouth = 'none',
  eyeColor = '#ffffff',
  title,
  className,
}: PersonaAvatarProps) {
  const height = (size * VIEWBOX_H) / VIEWBOX_W;
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      width={size}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', overflow: 'visible' }}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      <Fragment>
        <CrownShape crown={crown} color={color} />
        {/* Feet first, then the main body sits on top */}
        <rect x={22} y={80} width={24} height={22} rx={11} fill={color} />
        <rect x={54} y={80} width={24} height={22} rx={11} fill={color} />
        <rect x={14} y={30} width={72} height={64} rx={22} fill={color} />
        <Eyes eyes={eyes} look={look} color={eyeColor} />
        <Mouth mouth={mouth} color={eyeColor} />
      </Fragment>
    </svg>
  );
}
