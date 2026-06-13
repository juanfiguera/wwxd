import { streamText, generateText, type ModelMessage } from 'ai';
import { z } from 'zod';
import { stat } from 'node:fs/promises';
import {
  GATE_INSTRUCTION,
  parseGateDecision,
  shouldRunGate,
  someoneHasSpokenSinceLastUser,
} from '@/lib/gate';
import { cacheableProviderOptions, modelFor } from '@/lib/llm';
import {
  buildStaticPersona,
  buildRetrievalBlock,
  corpusPath,
  loadCorpus,
  type Corpus,
  type Tweet,
} from '@/lib/persona';
import {
  embedQuery,
  embeddingsPath,
  hybridTopK,
  loadEmbeddings,
  type LoadedEmbeddings,
} from '@/lib/retrieve';
import { buildBm25, type Bm25Index } from '@/lib/bm25';
import { classifyRisk, riskSystemAddendumFor } from '@/lib/risk-classifier';

export const maxDuration = 300;

const TOP_K = Number(process.env.RETRIEVE_TOP_K ?? '20');
const GATE_ENABLED = process.env.ROUNDTABLE_GATE !== 'false';

const Body = z.object({
  speaker: z.string().min(1),
  speakers: z
    .array(z.object({ username: z.string().min(1), displayName: z.string().min(1) }))
    .min(1),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      speaker: z.string().optional(),
    }),
  ),
});

type CorpusCache = {
  mtime: number;
  corpus: Corpus;
  staticPrompt: string;
  tweetById: Map<string, Tweet>;
  bm25: Bm25Index;
};
const corpusCache = new Map<string, CorpusCache>();

async function getCorpusBundle(username: string): Promise<CorpusCache> {
  const path = corpusPath(username);
  const { mtimeMs } = await stat(path);
  const cached = corpusCache.get(username);
  if (cached && cached.mtime === mtimeMs) return cached;
  const corpus = await loadCorpus(username);
  const staticPrompt = buildStaticPersona(corpus);
  const tweetById = new Map(corpus.tweets.map((t) => [t.id, t]));
  const bm25 = buildBm25(corpus.tweets.filter((t) => t.text.length > 0));
  const entry: CorpusCache = { mtime: mtimeMs, corpus, staticPrompt, tweetById, bm25 };
  corpusCache.set(username, entry);
  return entry;
}

async function tryLoadEmbeddings(username: string): Promise<LoadedEmbeddings | null> {
  try {
    await stat(embeddingsPath(username));
  } catch {
    return null;
  }
  return loadEmbeddings(username);
}

function buildRoundtableAddendum(
  speakers: { username: string; displayName: string }[],
  self: string,
): string {
  const others = speakers.filter((s) => s.username !== self);
  if (others.length === 0) return '';
  const selfName = speakers.find((s) => s.username === self)?.displayName ?? self;
  const list = others.map((s) => `${s.displayName} (@${s.username})`).join(', ');
  return `=== ROUNDTABLE MODE ===
You're in a roundtable with: ${list}.

The user is asking the whole group, not just one person. Share YOUR take in your voice — concisely, sharply, as ${selfName} would in a panel. If you're the first to speak, set the tone; don't wait for the others.

If others have already spoken (their words appear in user messages as "[Their Name]: ..."), feel free to agree, disagree, build on, or push back by name. But you do NOT need to react to them — a fresh take is just as valid as a reaction.

Stay fully in character. If the user asks about chat platforms, AI personas, simulation, or anything meta, respond as the real ${selfName} would respond to a journalist asking the same thing — engage with the substance, don't break the frame to comment on "being a simulation".`;
}

function buildPovMessages(
  history: { role: 'user' | 'assistant'; text: string; speaker?: string }[],
  speakers: { username: string; displayName: string }[],
  self: string,
): { messages: ModelMessage[]; lastUserText: string } {
  const nameByUsername = new Map(speakers.map((s) => [s.username, s.displayName]));
  const messages: ModelMessage[] = [];
  let pending: string[] = [];
  let lastUserText = '';

  function flushPending(): void {
    if (pending.length === 0) return;
    messages.push({ role: 'user', content: pending.join('\n\n') });
    pending = [];
  }

  for (const msg of history) {
    if (!msg.text.trim()) continue;
    if (msg.role === 'user') {
      pending.push(`[User]: ${msg.text}`);
      lastUserText = msg.text;
    } else if (msg.role === 'assistant') {
      if (msg.speaker === self) {
        flushPending();
        messages.push({ role: 'assistant', content: msg.text });
      } else if (msg.speaker) {
        const name = nameByUsername.get(msg.speaker) ?? msg.speaker;
        pending.push(`[${name}]: ${msg.text}`);
      }
    }
  }

  flushPending();
  return { messages, lastUserText };
}

function injectPreludeIntoLastUserMessage(
  messages: ModelMessage[],
  prelude: string,
): ModelMessage[] {
  if (!prelude) return messages;
  if (messages.length === 0) {
    return [{ role: 'user', content: prelude }];
  }
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (last.role !== 'user') {
    return [...messages, { role: 'user', content: prelude }];
  }
  const existingParts = Array.isArray(last.content)
    ? last.content
    : [{ type: 'text' as const, text: last.content }];
  const augmented: ModelMessage = {
    role: 'user',
    content: [{ type: 'text', text: prelude }, ...existingParts],
  };
  return [...messages.slice(0, lastIdx), augmented];
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }
  const { speaker, speakers, history } = parsed.data;

  let bundle: CorpusCache;
  try {
    bundle = await getCorpusBundle(speaker);
  } catch (err) {
    return Response.json(
      {
        error: `Could not load tweets for @${speaker}. (${err instanceof Error ? err.message : err})`,
      },
      { status: 500 },
    );
  }

  const hasEmbeddingProvider = Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.EMBEDDING_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.EMBEDDING_BASE_URL ||
      process.env.LLM_BASE_URL,
  );
  const embeddings = hasEmbeddingProvider ? await tryLoadEmbeddings(speaker) : null;
  const { messages: povMessages, lastUserText } = buildPovMessages(history, speakers, speaker);

  // Run retrieval, and (only for the first speaker in the round) risk
  // classification in parallel. The classifier output is reused as the
  // disclaimer preamble — we only inject it for the FIRST persona who
  // actually speaks, so a 4-persona roundtable doesn't repeat the
  // disclaimer four times.
  const isFirstSpeakerThisTurn = !someoneHasSpokenSinceLastUser(history);
  const retrievalPromise = (async (): Promise<Tweet[]> => {
    if (!lastUserText) return [];
    try {
      let queryVec: Float32Array | null = null;
      if (embeddings) {
        queryVec = await embedQuery(lastUserText);
      }
      const topIds = hybridTopK(embeddings, queryVec, bundle.bm25, lastUserText, TOP_K);
      return topIds
        .map((id) => bundle.tweetById.get(id))
        .filter((t): t is Tweet => Boolean(t));
    } catch (err) {
      console.error('Roundtable retrieval failed:', err);
      return [];
    }
  })();
  const riskPromise =
    isFirstSpeakerThisTurn && lastUserText
      ? classifyRisk(lastUserText)
      : Promise.resolve(null);
  const [retrievedTweets, riskCategory] = await Promise.all([
    retrievalPromise,
    riskPromise,
  ]);

  const addendum = buildRoundtableAddendum(speakers, speaker);
  // Prior-only personas have no corpus; suppress the retrieval block so it
  // doesn't contradict the "no curated corpus attached" line in the static
  // prompt. The gate still runs without the block (it's about whether the
  // persona has something to add, not about retrieval).
  const isPriorOnly = bundle.corpus.mode === 'prior-only';
  const retrievalBlock = isPriorOnly ? '' : buildRetrievalBlock(retrievedTweets);
  // Risk disclaimer goes in the SYSTEM channel — never the user channel —
  // so the persona doesn't read it as prompt injection and refuse.
  const riskAddendum = riskSystemAddendumFor(riskCategory);

  const retrievedMeta = retrievedTweets.map((t) => ({
    id: t.id,
    text: t.text,
    url: t.url,
    createdAt: t.createdAt,
    source: t.source ?? 'tweet',
    title: t.title,
  }));

  // Gate: cheap decision call to skip personas who don't have a real take.
  // Skip the gate for the first speaker each turn — someone has to speak first,
  // and a cascade of "I'll wait for them" passes is the failure mode we're avoiding.
  if (
    GATE_ENABLED &&
    !isFirstSpeakerThisTurn &&
    shouldRunGate(speakers.length, Boolean(lastUserText))
  ) {
    try {
      const gatePrelude = [addendum, retrievalBlock, GATE_INSTRUCTION]
        .filter(Boolean)
        .join('\n\n');
      const gateMessages = injectPreludeIntoLastUserMessage(povMessages, gatePrelude);
      const gateResult = await generateText({
        model: modelFor('gate'),
        system: bundle.staticPrompt,
        messages: gateMessages,
        providerOptions: cacheableProviderOptions(),
      });
      const decision = parseGateDecision(gateResult.text);
      if (!decision.speak) {
        return Response.json(
          { passed: true, reason: decision.reason, speaker },
          {
            status: 200,
            headers: {
              'X-Retrieved-Tweets': encodeURIComponent(JSON.stringify(retrievedMeta)),
            },
          },
        );
      }
    } catch (err) {
      console.error(`[roundtable] @${speaker} gate failed:`, err);
    }
  }
  const prelude = [addendum, retrievalBlock].filter(Boolean).join('\n\n');
  const finalMessages = injectPreludeIntoLastUserMessage(povMessages, prelude);

  const speakSystemPrompt = riskAddendum
    ? `${bundle.staticPrompt}\n\n${riskAddendum}`
    : bundle.staticPrompt;

  const result = streamText({
    model: modelFor('chat'),
    system: speakSystemPrompt,
    messages: finalMessages,
    providerOptions: cacheableProviderOptions(),
  });

  // Build a custom ReadableStream so we can catch upstream provider errors
  // (rate limit, billing, model unavailable) and forward them to the client
  // with a sentinel prefix. The default toTextStreamResponse swallows
  // these errors silently, leaving the client to display "(model returned
  // empty response)" instead of the actual reason.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`__WWXD_STREAM_ERROR__${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Retrieved-Tweets': encodeURIComponent(JSON.stringify(retrievedMeta)),
    },
  });
}
