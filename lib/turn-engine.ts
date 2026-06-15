/**
 * One unified per-persona turn engine for both solo and roundtable surfaces.
 *
 * A turn is "this persona, replying to this history, in this mode". The
 * engine loads the corpus bundle, runs retrieval (with a query-level
 * embedding cache so a 6-persona roundtable embeds the user query once),
 * optionally runs the risk classifier and the speaker gate, builds the
 * system prompt + message list, and streams the response.
 *
 * Output is a ReadableStream<TurnStreamPart> the route layer encodes for
 * the wire (Phase 2 of the refactor plan). For this PR there is no route
 * shell yet; both routes will switch over in Phase 1.5 behind the
 * WWXD_USE_TURN_ENGINE flag.
 *
 * Mode-specific differences:
 *   - solo: no gate; risk classifier always runs when there's a query.
 *     History is a plain user/assistant trace.
 *   - roundtable: gate runs unless this is the first speaker since the
 *     last user message. Risk classifier only runs for that first speaker
 *     so the disclaimer doesn't repeat per persona. History is rewritten
 *     into the speaking persona's POV with `[Name]:` prefixes so the model
 *     can reference others by name.
 */

import { streamText, generateText, type ModelMessage } from 'ai';
import { stat } from 'node:fs/promises';
import { appendEvent, upsertMessage, type ConversationEventKind } from './db';
import {
  GATE_INSTRUCTION,
  parseGateDecision,
  shouldRunGate,
  someoneHasSpokenSinceLastUser,
} from './gate';
import { cacheableProviderOptions, embeddingModelId, modelFor } from './llm';
import { buildRetrievalBlock, type Tweet } from './persona';
import { getCorpusBundle, type CorpusBundle } from './persona-cache';
import {
  embedQuery,
  embeddingsPath,
  hybridTopK,
  loadEmbeddings,
  type LoadedEmbeddings,
} from './retrieve';
import { classifyRisk, riskSystemAddendumFor } from './risk-classifier';

const TOP_K = Number(process.env.RETRIEVE_TOP_K ?? '20');
const GATE_ENABLED = process.env.ROUNDTABLE_GATE !== 'false';
const QUERY_CACHE_MAX = 500;

export type HistoryMessage = {
  role: 'user' | 'assistant';
  text: string;
  /** Required for assistant messages in roundtable mode. */
  speaker?: string;
};

export type RetrievedTweetMeta = {
  id: string;
  text: string;
  url: string;
  createdAt: string;
  source: string;
  title?: string;
};

export type Speaker = { username: string; displayName: string };

export type TurnRequest = {
  speaker: string;
  speakers: Speaker[];
  history: HistoryMessage[];
  mode: 'solo' | 'roundtable';
  signal?: AbortSignal;
  /**
   * Optional conversation tracing. When both are present the engine writes
   * structured rows to conversation_events at gate / retrieval / risk /
   * persona start+complete+error. Missing either suppresses logging — used
   * by tests and by callers that don't have a persisted conversation yet.
   */
  conversationId?: string;
  ordinal?: number;
  /**
   * Phase 2.2: when present along with conversationId + ordinal, the engine
   * writes the assistant message to the DB on stream end (including when
   * the client disconnected mid-stream — see wrapLlmStream). Lets the user
   * reload the page and recover what was already streamed.
   */
  assistantMessageId?: string;
};

export type TurnStreamPart =
  | { type: 'text'; value: string }
  | { type: 'gate-passed'; reason: string }
  | { type: 'error'; message: string; code?: string };

export type TurnResult = {
  stream: ReadableStream<TurnStreamPart>;
  retrievedMeta: RetrievedTweetMeta[];
};

// ─── Query-level embedding cache ──────────────────────────────────────────
// Keyed by `(embeddingModelId, query)` so flipping models doesn't return
// stale vectors. Simple FIFO eviction at QUERY_CACHE_MAX. Exposed clear()
// for tests and for future "user logged out / wiped data" paths.

const queryEmbedCache = new Map<string, Float32Array>();

async function embedQueryCached(query: string): Promise<Float32Array> {
  const key = `${embeddingModelId()}:${query}`;
  const hit = queryEmbedCache.get(key);
  if (hit) return hit;
  const vec = await embedQuery(query);
  if (queryEmbedCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryEmbedCache.keys().next().value;
    if (oldest !== undefined) queryEmbedCache.delete(oldest);
  }
  queryEmbedCache.set(key, vec);
  return vec;
}

export function clearQueryEmbedCache(): void {
  queryEmbedCache.clear();
}

export function queryEmbedCacheSize(): number {
  return queryEmbedCache.size;
}

// ─── Embeddings loader ────────────────────────────────────────────────────

async function tryLoadEmbeddings(username: string): Promise<LoadedEmbeddings | null> {
  try {
    await stat(embeddingsPath(username));
  } catch {
    return null;
  }
  return loadEmbeddings(username);
}

function hasEmbeddingProvider(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.EMBEDDING_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.EMBEDDING_BASE_URL ||
      process.env.LLM_BASE_URL,
  );
}

// ─── Message builders ─────────────────────────────────────────────────────

function buildSoloMessages(history: HistoryMessage[]): {
  messages: ModelMessage[];
  lastUserText: string;
} {
  const messages: ModelMessage[] = [];
  let lastUserText = '';
  for (const msg of history) {
    if (!msg.text.trim()) continue;
    messages.push({ role: msg.role, content: msg.text });
    if (msg.role === 'user') lastUserText = msg.text;
  }
  return { messages, lastUserText };
}

function buildPovMessages(
  history: HistoryMessage[],
  speakers: Speaker[],
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

function buildRoundtableAddendum(speakers: Speaker[], self: string): string {
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

// ─── Stream helpers ───────────────────────────────────────────────────────

function singlePartStream(part: TurnStreamPart): ReadableStream<TurnStreamPart> {
  return new ReadableStream<TurnStreamPart>({
    start(controller) {
      controller.enqueue(part);
      controller.close();
    },
  });
}

type EmitFn = (kind: ConversationEventKind, payload?: unknown) => void;

/**
 * Build a per-turn emit() that writes to conversation_events only when
 * the caller supplied both a conversationId and an ordinal. Failed writes
 * are swallowed (the persona must still get to speak) but logged.
 */
function makeEmit(req: TurnRequest): EmitFn {
  if (req.conversationId === undefined || req.ordinal === undefined) {
    return () => {
      /* tracing disabled for this turn */
    };
  }
  const conversationId = req.conversationId;
  const ordinal = req.ordinal;
  const speaker = req.speaker;
  return (kind, payload) => {
    try {
      appendEvent({ conversationId, ordinal, kind, speaker, payload });
    } catch (err) {
      console.error('[turn-engine] appendEvent failed:', err);
    }
  };
}

/**
 * Phase 2.2 save target. The engine carries these so it can checkpoint the
 * assistant message to the messages table when the stream ends (success,
 * abort, OR client disconnect). Missing any field disables saving.
 */
type AssistantSaveCtx = {
  conversationId: string;
  speaker: string;
  ordinal: number;
  assistantMessageId: string;
  retrievedMeta: RetrievedTweetMeta[];
};

function saveAssistantText(
  ctx: AssistantSaveCtx | null,
  text: string,
  isPartial: boolean,
): void {
  if (!ctx) return;
  try {
    upsertMessage(ctx.conversationId, {
      id: ctx.assistantMessageId,
      role: 'assistant',
      speaker: ctx.speaker,
      text,
      metadata: ctx.retrievedMeta.length > 0 ? { retrievedTweets: ctx.retrievedMeta } : null,
      ordinal: ctx.ordinal,
      isPartial,
    });
  } catch (err) {
    console.error('[turn-engine] upsertMessage failed:', err);
  }
}

function wrapLlmStream(
  textStream: AsyncIterable<string>,
  signal: AbortSignal | undefined,
  emit: EmitFn,
  saveCtx: AssistantSaveCtx | null,
): ReadableStream<TurnStreamPart> {
  let accumulated = '';
  return new ReadableStream<TurnStreamPart>({
    async start(controller) {
      try {
        for await (const chunk of textStream) {
          if (signal?.aborted) {
            controller.enqueue({ type: 'error', message: 'aborted', code: 'aborted' });
            emit('persona.errored', { message: 'aborted', code: 'aborted', chars: accumulated.length });
            // Partial save before bailing.
            saveAssistantText(saveCtx, accumulated, true);
            controller.close();
            return;
          }
          accumulated += chunk;
          controller.enqueue({ type: 'text', value: chunk });
        }
        emit('persona.completed', { chars: accumulated.length });
        saveAssistantText(saveCtx, accumulated, false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue({ type: 'error', message, code: 'upstream' });
        emit('persona.errored', { message, code: 'upstream', chars: accumulated.length });
        // Whatever we got is worth keeping; mark partial.
        if (accumulated.length > 0) saveAssistantText(saveCtx, accumulated, true);
      } finally {
        controller.close();
      }
    },
    // Fires when the downstream consumer cancels (e.g., user closed the
    // tab mid-roundtable and the SSE response stream was aborted). We have
    // whatever text reached us via the textStream loop above. Persist it.
    cancel() {
      saveAssistantText(saveCtx, accumulated, true);
    },
  });
}

// ─── prepareTurn ──────────────────────────────────────────────────────────

/**
 * Inputs the engine has prepared for the LLM speak call. Callers that need
 * full control over the wire format (the solo route uses AI SDK's
 * `toUIMessageStreamResponse`) build their own streamText() call from these.
 */
export type PreparedSpeak = {
  bundle: CorpusBundle;
  systemPrompt: string;
  messages: ModelMessage[];
  retrievedMeta: RetrievedTweetMeta[];
  emit: EmitFn;
  signal?: AbortSignal;
};

export type PrepareResult =
  | { kind: 'speak'; inputs: PreparedSpeak }
  | { kind: 'gate-passed'; reason: string; retrievedMeta: RetrievedTweetMeta[]; emit: EmitFn };

export async function prepareTurn(req: TurnRequest): Promise<PrepareResult> {
  const { speaker, speakers, history, mode, signal } = req;
  const emit = makeEmit(req);
  emit('persona.started', { mode });

  const bundle: CorpusBundle = await getCorpusBundle(speaker);

  const built =
    mode === 'solo'
      ? buildSoloMessages(history)
      : buildPovMessages(history, speakers, speaker);
  const { messages: povMessages, lastUserText } = built;

  const isFirstSpeakerThisTurn =
    mode === 'roundtable' ? !someoneHasSpokenSinceLastUser(history) : true;
  const shouldClassifyRisk =
    Boolean(lastUserText) && (mode === 'solo' || isFirstSpeakerThisTurn);

  const embeddings = hasEmbeddingProvider() ? await tryLoadEmbeddings(speaker) : null;
  const retrievalPromise = (async (): Promise<Tweet[]> => {
    if (!lastUserText) return [];
    try {
      let queryVec: Float32Array | null = null;
      if (embeddings) {
        queryVec = await embedQueryCached(lastUserText);
      }
      const topIds = hybridTopK(embeddings, queryVec, bundle.bm25, lastUserText, TOP_K);
      return topIds
        .map((id) => bundle.tweetById.get(id))
        .filter((t): t is Tweet => Boolean(t));
    } catch (err) {
      console.error('Turn retrieval failed, falling back to voice-only:', err);
      return [];
    }
  })();
  const riskPromise = shouldClassifyRisk ? classifyRisk(lastUserText) : Promise.resolve(null);
  const [retrievedTweets, riskCategory] = await Promise.all([retrievalPromise, riskPromise]);
  emit('retrieval', {
    topK: TOP_K,
    hits: retrievedTweets.length,
    tweetIds: retrievedTweets.map((t) => t.id),
    query: lastUserText,
  });
  if (shouldClassifyRisk) emit('risk.classified', { category: riskCategory, query: lastUserText });

  const isPriorOnly = bundle.corpus.mode === 'prior-only';
  const retrievalBlock = isPriorOnly ? '' : buildRetrievalBlock(retrievedTweets);
  const addendum = mode === 'roundtable' ? buildRoundtableAddendum(speakers, speaker) : '';
  const riskAddendum = riskSystemAddendumFor(riskCategory);

  const retrievedMeta: RetrievedTweetMeta[] = retrievedTweets.map((t) => ({
    id: t.id,
    text: t.text,
    url: t.url,
    createdAt: t.createdAt,
    source: t.source ?? 'tweet',
    title: t.title,
  }));

  if (
    mode === 'roundtable' &&
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
        emit('gate.passed', { reason: decision.reason });
        return { kind: 'gate-passed', reason: decision.reason, retrievedMeta, emit };
      }
      emit('gate.spoke');
    } catch (err) {
      console.error(`[turn-engine] @${speaker} gate failed:`, err);
      // Fall through to speak path; better a noisy persona than a silent one.
    }
  }

  const prelude = [addendum, retrievalBlock].filter(Boolean).join('\n\n');
  const finalMessages = injectPreludeIntoLastUserMessage(povMessages, prelude);
  const systemPrompt = riskAddendum
    ? `${bundle.staticPrompt}\n\n${riskAddendum}`
    : bundle.staticPrompt;

  return {
    kind: 'speak',
    inputs: {
      bundle,
      systemPrompt,
      messages: finalMessages,
      retrievedMeta,
      emit,
      signal,
    },
  };
}

// ─── runTurn ──────────────────────────────────────────────────────────────

export async function runTurn(req: TurnRequest): Promise<TurnResult> {
  const prep = await prepareTurn(req);
  if (prep.kind === 'gate-passed') {
    return {
      stream: singlePartStream({ type: 'gate-passed', reason: prep.reason }),
      retrievedMeta: prep.retrievedMeta,
    };
  }
  const { systemPrompt, messages, retrievedMeta, emit, signal } = prep.inputs;
  const result = streamText({
    model: modelFor('chat'),
    system: systemPrompt,
    messages,
    providerOptions: cacheableProviderOptions(),
    abortSignal: signal,
  });
  const saveCtx: AssistantSaveCtx | null =
    req.conversationId !== undefined &&
    req.ordinal !== undefined &&
    req.assistantMessageId !== undefined
      ? {
          conversationId: req.conversationId,
          speaker: req.speaker,
          ordinal: req.ordinal,
          assistantMessageId: req.assistantMessageId,
          retrievedMeta,
        }
      : null;
  return {
    stream: wrapLlmStream(result.textStream, signal, emit, saveCtx),
    retrievedMeta,
  };
}
