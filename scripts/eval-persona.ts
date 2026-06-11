import { generateText } from 'ai';
import { modelFor } from '../lib/llm';
import { buildStaticPersona, loadCorpus } from '../lib/persona';
import {
  deterministicSample,
  parseDimensionalScores,
  summarizeScores,
  type DimensionalScores,
} from '../lib/evals';
import { saveEvalRun } from '../lib/db';

const SAMPLE_COUNT = Number(process.env.EVAL_SAMPLE ?? '15');
const SEED = process.env.EVAL_SEED ?? 'wwxd-eval-v2';

async function extractQuestion(tweetText: string, displayName: string): Promise<string> {
  const result = await generateText({
    model: modelFor('gate'),
    messages: [
      {
        role: 'user',
        content: `${displayName} once tweeted: "${tweetText}"\n\nWrite a short, neutral question someone might've asked them that this tweet could be a response to. Reply with ONLY the question, no quotes, no preamble.`,
      },
    ],
  });
  return result.text.trim().replace(/^["']|["']$/g, '');
}

async function generateInPersona(question: string, staticPrompt: string): Promise<string> {
  const result = await generateText({
    model: modelFor('chat'),
    system: staticPrompt,
    messages: [{ role: 'user', content: question }],
  });
  return result.text.trim();
}

async function judgeMultiDim(
  actual: string,
  generated: string,
  displayName: string,
): Promise<DimensionalScores> {
  const result = await generateText({
    model: modelFor('judge'),
    messages: [
      {
        role: 'user',
        content: `You are evaluating an AI persona of ${displayName}.

The real ${displayName} actually wrote this:
"""
${actual}
"""

The candidate text is:
"""
${generated}
"""

Score the candidate 0-10 on three dimensions:

VOICE: cadence, rhythm, sentence length, vocabulary — does it READ like ${displayName}?
STANCE: opinions and worldview — does the take match what the real ${displayName} would actually argue?
TOPIC: subject matter — is it engaging with the same thing as the real tweet, or off-topic?

Reply with EXACTLY:
VOICE: <integer 0-10>
STANCE: <integer 0-10>
TOPIC: <integer 0-10>
NOTE: <one sentence on the main gap>`,
      },
    ],
  });
  return parseDimensionalScores(result.text);
}

type EvalResultRow = {
  holdOutId: string;
  holdOutText: string;
  question: string;
  generated: string;
  generatedScores: DimensionalScores;
  baselineScores: DimensionalScores;
};

async function main(): Promise<void> {
  const username = process.argv[2] ?? 'garrytan';
  const corpus = await loadCorpus(username);

  const originals = corpus.tweets.filter(
    (t) => !t.isReply && !t.isRetweet && t.text.length > 20 && (t.source ?? 'tweet') === 'tweet',
  );
  const sample = deterministicSample(originals, SAMPLE_COUNT, SEED);

  if (sample.length === 0) {
    console.error(`No suitable tweets to sample for @${username}`);
    process.exit(1);
  }

  console.log(`Evaluating @${username} on ${sample.length} held-out tweets...\n`);

  const heldOutIds = new Set(sample.map((t) => t.id));
  const trainingCorpus = {
    ...corpus,
    tweets: corpus.tweets.filter((t) => !heldOutIds.has(t.id)),
  };
  const staticPrompt = buildStaticPersona(trainingCorpus);

  const results: EvalResultRow[] = [];
  let idx = 0;
  for (const tweet of sample) {
    idx += 1;
    const preview = tweet.text.replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  [${idx}/${sample.length}] ${preview}...`);
    try {
      const question = await extractQuestion(tweet.text, corpus.displayName);
      const generated = await generateInPersona(question, staticPrompt);
      // Multi-dim judge on generated output
      const generatedScores = await judgeMultiDim(tweet.text, generated, corpus.displayName);
      // Baseline: judge the REAL tweet against itself — sets the ceiling
      const baselineScores = await judgeMultiDim(tweet.text, tweet.text, corpus.displayName);
      console.log(
        `    gen   voice=${generatedScores.voice} stance=${generatedScores.stance} topic=${generatedScores.topic}`,
      );
      console.log(
        `    real  voice=${baselineScores.voice} stance=${baselineScores.stance} topic=${baselineScores.topic}`,
      );
      results.push({
        holdOutId: tweet.id,
        holdOutText: tweet.text,
        question,
        generated,
        generatedScores,
        baselineScores,
      });
    } catch (err) {
      console.error(`    failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const genVoice = summarizeScores(results.map((r) => r.generatedScores.voice));
  const genStance = summarizeScores(results.map((r) => r.generatedScores.stance));
  const genTopic = summarizeScores(results.map((r) => r.generatedScores.topic));
  const baseVoice = summarizeScores(results.map((r) => r.baselineScores.voice));
  const baseStance = summarizeScores(results.map((r) => r.baselineScores.stance));
  const baseTopic = summarizeScores(results.map((r) => r.baselineScores.topic));

  const summary = {
    username,
    displayName: corpus.displayName,
    sampleCount: sample.length,
    completedCount: results.length,
    seed: SEED,
    models: {
      judge: process.env.JUDGE_MODEL ?? null,
      subject: process.env.CHAT_MODEL ?? null,
      question: process.env.GATE_MODEL ?? null,
    },
    generated: { voice: genVoice, stance: genStance, topic: genTopic },
    baseline: { voice: baseVoice, stance: baseStance, topic: baseTopic },
    gap: {
      voice: baseVoice.avg - genVoice.avg,
      stance: baseStance.avg - genStance.avg,
      topic: baseTopic.avg - genTopic.avg,
    },
  };

  const runId = saveEvalRun(
    'voice',
    summary,
    results.map((r) => ({ username, result: r })),
  );

  console.log(`\n${corpus.displayName} (@${username}) — voice eval`);
  console.log(
    `  generated  voice ${genVoice.avg.toFixed(1)}  stance ${genStance.avg.toFixed(1)}  topic ${genTopic.avg.toFixed(1)}`,
  );
  console.log(
    `  baseline   voice ${baseVoice.avg.toFixed(1)}  stance ${baseStance.avg.toFixed(1)}  topic ${baseTopic.avg.toFixed(1)}`,
  );
  console.log(
    `  gap        voice ${summary.gap.voice.toFixed(1)}  stance ${summary.gap.stance.toFixed(1)}  topic ${summary.gap.topic.toFixed(1)}`,
  );
  console.log(`\nSaved run ${runId} — see /evals`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
