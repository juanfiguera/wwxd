import { generateText } from 'ai';
import { modelFor } from '../lib/llm';
import { buildStaticPersona, loadCorpus, type Corpus } from '../lib/persona';
import {
  deterministicSample,
  parseDiscriminationGuess,
  type DiscriminationGuess,
} from '../lib/evals';
import { saveEvalRun } from '../lib/db';

const QUESTIONS_PER_PERSONA = Number(process.env.DISCRIM_QUESTIONS ?? '3');
const SEED = process.env.EVAL_SEED ?? 'wwxd-discrim-v1';

type Persona = {
  username: string;
  corpus: Corpus;
  staticPrompt: string;
};

async function extractQuestion(tweetText: string, displayName: string): Promise<string> {
  const result = await generateText({
    model: modelFor('gate'),
    messages: [
      {
        role: 'user',
        content: `${displayName} once tweeted: "${tweetText}"\n\nWrite a short, neutral question someone might've asked them that this tweet could be a response to. The question should be general enough that other people in tech could also answer it. Reply with ONLY the question.`,
      },
    ],
  });
  return result.text.trim().replace(/^["']|["']$/g, '');
}

async function generateInPersona(question: string, persona: Persona): Promise<string> {
  const result = await generateText({
    model: modelFor('chat'),
    system: persona.staticPrompt,
    messages: [{ role: 'user', content: question }],
  });
  return result.text.trim();
}

async function judgeDiscrimination(
  response: string,
  personaList: { username: string; displayName: string }[],
): Promise<DiscriminationGuess> {
  const list = personaList
    .map((p, i) => `${i + 1}. ${p.displayName} (@${p.username})`)
    .join('\n');
  const result = await generateText({
    model: modelFor('judge'),
    messages: [
      {
        role: 'user',
        content: `Below is a piece of writing. It was generated in the style of ONE of these people:

${list}

The writing:
"""
${response}
"""

Which person does this MOST sound like? Reply with EXACTLY:
PERSON: <handle without @>
CONFIDENCE: <integer 0-10>
NOTE: <one sentence on what tipped you off>`,
      },
    ],
  });
  return parseDiscriminationGuess(result.text);
}

async function loadPersona(username: string): Promise<Persona> {
  const corpus = await loadCorpus(username);
  const staticPrompt = buildStaticPersona(corpus);
  return { username, corpus, staticPrompt };
}

async function main(): Promise<void> {
  const usernames = process.argv.slice(2);
  if (usernames.length < 2) {
    console.error('Usage: pnpm eval-discriminate <user1> <user2> [user3] ...');
    process.exit(1);
  }

  console.log(`Loading ${usernames.length} personas...`);
  const personas = await Promise.all(usernames.map(loadPersona));
  const personaList = personas.map((p) => ({
    username: p.username,
    displayName: p.corpus.displayName,
  }));

  // Build a pool of questions, drawn evenly from each persona's tweets.
  const questions: { sourceUsername: string; question: string }[] = [];
  for (const p of personas) {
    const originals = p.corpus.tweets.filter(
      (t) => !t.isReply && !t.isRetweet && t.text.length > 20 && (t.source ?? 'tweet') === 'tweet',
    );
    const sample = deterministicSample(originals, QUESTIONS_PER_PERSONA, `${SEED}-${p.username}`);
    for (const tweet of sample) {
      const question = await extractQuestion(tweet.text, p.corpus.displayName);
      questions.push({ sourceUsername: p.username, question });
    }
  }

  console.log(`Generated ${questions.length} questions. Now: every persona answers each.\n`);

  const trials: {
    question: string;
    trueUsername: string;
    response: string;
    guess: DiscriminationGuess;
    correct: boolean;
  }[] = [];

  let trialIdx = 0;
  for (const q of questions) {
    for (const persona of personas) {
      trialIdx += 1;
      const total = questions.length * personas.length;
      const preview = q.question.slice(0, 50).replace(/\s+/g, ' ');
      process.stdout.write(`  [${trialIdx}/${total}] @${persona.username} on "${preview}..."  `);
      try {
        const response = await generateInPersona(q.question, persona);
        const guess = await judgeDiscrimination(response, personaList);
        const correct = guess.guessedUsername === persona.username;
        console.log(
          `judge→ ${guess.guessedUsername ?? '?'} ${correct ? '✓' : '✗'} (conf ${guess.confidence})`,
        );
        trials.push({
          question: q.question,
          trueUsername: persona.username,
          response,
          guess,
          correct,
        });
      } catch (err) {
        console.log(`failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const correct = trials.filter((t) => t.correct).length;
  const total = trials.length;
  const accuracy = total > 0 ? correct / total : 0;
  const chance = 1 / personas.length;

  const byPersona = personas.map((p) => {
    const items = trials.filter((t) => t.trueUsername === p.username);
    const ok = items.filter((t) => t.correct).length;
    return {
      username: p.username,
      displayName: p.corpus.displayName,
      total: items.length,
      correct: ok,
      accuracy: items.length ? ok / items.length : 0,
    };
  });

  // Confusion matrix: rows = true persona, cols = guessed persona
  const confusion: Record<string, Record<string, number>> = {};
  for (const p of personas) {
    confusion[p.username] = {};
    for (const q of personas) confusion[p.username][q.username] = 0;
  }
  for (const t of trials) {
    if (t.guess.guessedUsername && confusion[t.trueUsername]?.[t.guess.guessedUsername] !== undefined) {
      confusion[t.trueUsername][t.guess.guessedUsername] += 1;
    }
  }

  const summary = {
    personas: personaList,
    questionsPerPersona: QUESTIONS_PER_PERSONA,
    totalTrials: total,
    overallAccuracy: accuracy,
    chance,
    byPersona,
    confusion,
    models: {
      judge: process.env.JUDGE_MODEL ?? null,
      subject: process.env.CHAT_MODEL ?? null,
      question: process.env.GATE_MODEL ?? null,
    },
  };

  const runId = saveEvalRun(
    'discrimination',
    summary,
    trials.map((t) => ({ username: t.trueUsername, result: t })),
  );

  console.log(`\nDiscrimination eval — ${personas.length} personas`);
  console.log(`  overall accuracy: ${(accuracy * 100).toFixed(0)}%  (chance = ${(chance * 100).toFixed(0)}%)`);
  for (const p of byPersona) {
    console.log(`    @${p.username.padEnd(20)} ${(p.accuracy * 100).toFixed(0)}%  (${p.correct}/${p.total})`);
  }
  console.log(`\nSaved run ${runId} — see /evals`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
