import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEvalRun } from '@/lib/db';
import { RelativeTime } from '@/app/components/relative-time';

type DimScores = { voice: number; stance: number; topic: number; note: string };

type VoiceResult = {
  holdOutId: string;
  holdOutText: string;
  question: string;
  generated: string;
  generatedScores: DimScores;
  baselineScores: DimScores;
};

type DiscrimResult = {
  question: string;
  trueUsername: string;
  response: string;
  guess: { guessedUsername: string | null; confidence: number; note: string };
  correct: boolean;
};

type VoiceSummary = {
  username: string;
  displayName: string;
  generated: { voice: { avg: number }; stance: { avg: number }; topic: { avg: number } };
  baseline: { voice: { avg: number }; stance: { avg: number }; topic: { avg: number } };
};

type DiscrimSummary = {
  personas: { username: string; displayName: string }[];
  overallAccuracy: number;
  chance: number;
  byPersona: { username: string; displayName: string; accuracy: number }[];
  confusion: Record<string, Record<string, number>>;
};

function VoiceDetail({
  summary,
  results,
}: {
  summary: VoiceSummary;
  results: VoiceResult[];
}) {
  const sortedByGap = [...results].sort((a, b) => {
    const aGap =
      (a.baselineScores.voice + a.baselineScores.stance + a.baselineScores.topic) / 3 -
      (a.generatedScores.voice + a.generatedScores.stance + a.generatedScores.topic) / 3;
    const bGap =
      (b.baselineScores.voice + b.baselineScores.stance + b.baselineScores.topic) / 3 -
      (b.generatedScores.voice + b.generatedScores.stance + b.generatedScores.topic) / 3;
    return bGap - aGap;
  });

  return (
    <div>
      <section className="mb-8">
        <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          Average scores
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {(['voice', 'stance', 'topic'] as const).map((dim) => (
            <div
              key={dim}
              className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]"
            >
              <div className="font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
                {dim}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-display text-2xl font-extrabold tabular-nums text-[var(--ink)]">
                  {summary.generated[dim].avg.toFixed(1)}
                </span>
                <span className="text-xs text-[var(--ink-soft)]">
                  / {summary.baseline[dim].avg.toFixed(1)} real
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--ink-soft)]">
          The &quot;/ real&quot; number is what the same judge scored the actual tweets at — your
          ceiling for this judge. A 7.0 generated vs 7.5 real means the persona is close.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          Lowest-scoring outputs (your prompt&apos;s biggest gaps)
        </h2>
        <ul className="space-y-3">
          {sortedByGap.slice(0, 5).map((r, i) => {
            const genAvg = (r.generatedScores.voice + r.generatedScores.stance + r.generatedScores.topic) / 3;
            const baseAvg = (r.baselineScores.voice + r.baselineScores.stance + r.baselineScores.topic) / 3;
            return (
              <li
                key={i}
                className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
                  Question
                </div>
                <div className="mb-3 text-sm text-[var(--ink)]">{r.question}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
                      Real tweet · {baseAvg.toFixed(1)}/10
                    </div>
                    <div className="mt-1 rounded-[var(--r)] bg-emerald-50 p-2 text-sm text-[var(--ink-2)]">
                      {r.holdOutText}
                    </div>
                  </div>
                  <div>
                    <div className="font-display text-[10px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
                      Generated · {genAvg.toFixed(1)}/10
                    </div>
                    <div className="mt-1 rounded-[var(--r)] bg-[var(--paper-2)] p-2 text-sm text-[var(--ink-2)]">
                      {r.generated}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-soft)]">
                  <span>voice {r.generatedScores.voice} (vs {r.baselineScores.voice})</span>
                  <span>stance {r.generatedScores.stance} (vs {r.baselineScores.stance})</span>
                  <span>topic {r.generatedScores.topic} (vs {r.baselineScores.topic})</span>
                </div>
                {r.generatedScores.note && (
                  <div className="mt-1 text-[11px] italic text-[var(--ink-soft)]">
                    judge: {r.generatedScores.note}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function DiscrimDetail({
  summary,
  results,
}: {
  summary: DiscrimSummary;
  results: DiscrimResult[];
}) {
  const usernames = summary.personas.map((p) => p.username);

  return (
    <div>
      <section className="mb-8">
        <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          Identification accuracy
        </h2>
        <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-sm)]">
          <div className="font-display text-3xl font-extrabold tabular-nums text-[var(--ink)]">
            {(summary.overallAccuracy * 100).toFixed(0)}%
          </div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            random guessing would be {(summary.chance * 100).toFixed(0)}% across{' '}
            {summary.personas.length} personas
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {summary.byPersona.map((p) => (
              <li key={p.username} className="rounded-[var(--r)] bg-[var(--paper-2)] p-2">
                <div className="font-display font-extrabold tabular-nums text-[var(--ink)]">
                  {(p.accuracy * 100).toFixed(0)}%
                </div>
                <div className="truncate text-[10px] text-[var(--ink-soft)]">{p.displayName}</div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-xs text-[var(--ink-soft)]">
          Each persona answered the same questions; the judge then had to identify who wrote each
          answer. High accuracy = distinct voices. Near-chance = everyone sounds alike.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          Confusion matrix
        </h2>
        <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="px-3 py-2 text-left font-display text-[var(--ink-soft)]">
                  true \ guessed
                </th>
                {usernames.map((u) => (
                  <th key={u} className="px-3 py-2 text-left font-mono text-[var(--ink-soft)]">
                    @{u}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usernames.map((trueU) => (
                <tr key={trueU} className="border-b border-[var(--line-2)]">
                  <td className="px-3 py-2 font-mono text-[var(--ink-soft)]">@{trueU}</td>
                  {usernames.map((guessedU) => {
                    const v = summary.confusion[trueU]?.[guessedU] ?? 0;
                    const isDiag = trueU === guessedU;
                    return (
                      <td
                        key={guessedU}
                        className={`px-3 py-2 text-center font-mono tabular-nums ${
                          isDiag && v > 0
                            ? 'bg-emerald-50 font-semibold text-emerald-700'
                            : v > 0
                              ? 'text-amber-600'
                              : 'text-[var(--ink-faint)]'
                        }`}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--ink-soft)]">
          Diagonal = correctly identified. Off-diagonal = persona X was mistaken for persona Y. If
          Garry-as-Garry is often guessed as Paul, those two voices are too similar.
        </p>
      </section>

      <section>
        <h2 className="mb-3 font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          Recent trials
        </h2>
        <ul className="space-y-2">
          {results.slice(0, 10).map((r, i) => (
            <li
              key={i}
              className={`rounded-[var(--r)] border p-3 text-xs ${
                r.correct
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-amber-200 bg-amber-50'
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[var(--ink-soft)]">@{r.trueUsername} answered:</span>
                <span className="font-mono">
                  judge → @{r.guess.guessedUsername ?? '?'} {r.correct ? '✓' : '✗'}
                </span>
              </div>
              <div className="text-sm text-[var(--ink)]">{r.response}</div>
              {r.guess.note && (
                <div className="mt-1 italic text-[var(--ink-soft)]">{r.guess.note}</div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default async function EvalRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = getEvalRun(id);
  if (!data) notFound();

  const { run, results } = data;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <header className="mb-8">
          <Link
            href="/evals"
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            ← all evals
          </Link>
          <h1 className="mt-1 font-display text-xl font-extrabold tracking-tight text-[var(--ink)]">
            {run.kind === 'voice' ? 'Voice eval' : 'Discrimination eval'}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
            ran <RelativeTime iso={run.ranAt} />
          </p>
        </header>

        {run.kind === 'voice' ? (
          <VoiceDetail
            summary={run.summary as VoiceSummary}
            results={results.map((r) => r.result as VoiceResult)}
          />
        ) : (
          <DiscrimDetail
            summary={run.summary as DiscrimSummary}
            results={results.map((r) => r.result as DiscrimResult)}
          />
        )}
      </div>
    </div>
  );
}
