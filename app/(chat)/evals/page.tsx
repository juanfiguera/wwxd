import Link from 'next/link';
import { listEvalRuns, type EvalRun } from '@/lib/db';
import { RelativeTime } from '@/app/components/relative-time';

type VoiceSummary = {
  username: string;
  displayName: string;
  sampleCount: number;
  completedCount: number;
  generated: {
    voice: { avg: number };
    stance: { avg: number };
    topic: { avg: number };
  };
  baseline: {
    voice: { avg: number };
    stance: { avg: number };
    topic: { avg: number };
  };
  gap: { voice: number; stance: number; topic: number };
};

type DiscrimSummary = {
  personas: { username: string; displayName: string }[];
  totalTrials: number;
  overallAccuracy: number;
  chance: number;
  byPersona: {
    username: string;
    displayName: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
};

function formatPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function VoiceRow({ run, summary }: { run: EvalRun; summary: VoiceSummary }) {
  return (
    <li className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--ink)]">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <Link
            href={`/evals/${run.id}`}
            className="font-display text-base font-extrabold tracking-tight text-[var(--ink)] hover:underline"
          >
            Voice eval · {summary.displayName}
          </Link>
          <div className="mt-0.5 text-xs text-[var(--ink-soft)]">
            @{summary.username} · {summary.completedCount} samples ·{' '}
            <RelativeTime iso={run.ranAt} />
          </div>
        </div>
        <Link
          href={`/evals/${run.id}`}
          className="shrink-0 text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
        >
          details →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <Dim
          label="voice"
          gen={summary.generated.voice.avg}
          base={summary.baseline.voice.avg}
          gap={summary.gap.voice}
        />
        <Dim
          label="stance"
          gen={summary.generated.stance.avg}
          base={summary.baseline.stance.avg}
          gap={summary.gap.stance}
        />
        <Dim
          label="topic"
          gen={summary.generated.topic.avg}
          base={summary.baseline.topic.avg}
          gap={summary.gap.topic}
        />
      </div>
    </li>
  );
}

function Dim({ label, gen, base, gap }: { label: string; gen: number; base: number; gap: number }) {
  const gapColor = gap > 4 ? 'text-red-600' : gap > 2 ? 'text-amber-600' : 'text-[var(--ink-soft)]';
  return (
    <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-2.5">
      <div className="font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-display text-base font-extrabold tabular-nums text-[var(--ink)]">
          {gen.toFixed(1)}
        </span>
        <span className="text-[10px] text-[var(--ink-soft)]">/ {base.toFixed(1)} real</span>
      </div>
      <div className={`text-[10px] ${gapColor}`}>
        gap {gap >= 0 ? '−' : '+'}
        {Math.abs(gap).toFixed(1)}
      </div>
    </div>
  );
}

function DiscrimRow({ run, summary }: { run: EvalRun; summary: DiscrimSummary }) {
  const names = summary.personas.map((p) => p.displayName).join(', ');
  const acc = summary.overallAccuracy;
  const ratio = summary.chance > 0 ? acc / summary.chance : 0;
  return (
    <li className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--ink)]">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/evals/${run.id}`}
            className="truncate font-display text-base font-extrabold tracking-tight text-[var(--ink)] hover:underline"
          >
            Discrimination · {names}
          </Link>
          <div className="mt-0.5 text-xs text-[var(--ink-soft)]">
            {summary.totalTrials} trials · <RelativeTime iso={run.ranAt} />
          </div>
        </div>
        <Link
          href={`/evals/${run.id}`}
          className="shrink-0 text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
        >
          details →
        </Link>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <span className="rounded-[var(--r)] bg-[var(--paper-2)] px-2 py-1">
          <span className="font-display text-base font-extrabold tabular-nums text-[var(--ink)]">
            {formatPct(acc)}
          </span>
          <span className="ml-1 text-[var(--ink-soft)]">accuracy</span>
        </span>
        <span className="text-[var(--ink-soft)]">
          vs {formatPct(summary.chance)} chance · {ratio.toFixed(1)}× better
        </span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
        {summary.byPersona.map((p) => (
          <li key={p.username} className="rounded-[var(--r)] bg-[var(--paper-2)] px-2 py-1">
            <div className="font-display font-extrabold tabular-nums text-[var(--ink)]">
              {formatPct(p.accuracy)}
            </div>
            <div className="truncate text-[10px] text-[var(--ink-soft)]">@{p.username}</div>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default async function EvalsPage() {
  const runs = listEvalRuns(undefined, 50);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <header className="mb-8 flex items-baseline justify-between gap-4">
          <div>
            <Link
              href="/settings"
              className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
            >
              ← settings
            </Link>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
              Evals
            </h1>
            <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
              How well does each persona actually sound like the real person?
            </p>
          </div>
        </header>

        {runs.length === 0 ? (
        <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-white p-8 text-sm text-[var(--ink-soft)]">
          <p className="font-display font-extrabold text-[var(--ink)]">No eval runs yet.</p>
          <p className="mt-2">Run one from the CLI:</p>
          <pre className="mt-2 overflow-x-auto rounded-[var(--r)] bg-[var(--paper-2)] p-3 font-mono text-xs text-[var(--ink-2)]">{`pnpm eval-persona garrytan
pnpm eval-discriminate garrytan paulg pmarca`}</pre>
        </div>
      ) : (
          <ul className="space-y-3">
            {runs.map((run) =>
              run.kind === 'voice' ? (
                <VoiceRow key={run.id} run={run} summary={run.summary as VoiceSummary} />
              ) : (
                <DiscrimRow key={run.id} run={run} summary={run.summary as DiscrimSummary} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
