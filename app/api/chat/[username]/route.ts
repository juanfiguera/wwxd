import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type ModelMessage,
} from 'ai';
import { stat } from 'node:fs/promises';
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

function extractLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = m.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

function injectRetrievalIntoLastUserMessage(
  messages: ModelMessage[],
  retrievalBlock: string,
): ModelMessage[] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (last.role !== 'user') return messages;

  const existingParts = Array.isArray(last.content)
    ? last.content
    : [{ type: 'text' as const, text: last.content }];

  const augmented: ModelMessage = {
    role: 'user',
    content: [{ type: 'text', text: retrievalBlock }, ...existingParts],
  };

  return [...messages.slice(0, lastIdx), augmented];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ username: string }> },
): Promise<Response> {
  const { username } = await params;

  let bundle: CorpusCache;
  try {
    bundle = await getCorpusBundle(username);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: `Could not load tweets for @${username}. Run "pnpm fetch-tweets ${username}" first. (${message})`,
      },
      { status: 500 },
    );
  }

  // Skip embedding-based retrieval if no embedding credential is configured.
  // The hybrid retriever falls back to BM25-only, so chat still works.
  const hasEmbeddingProvider = Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.EMBEDDING_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.EMBEDDING_BASE_URL ||
      process.env.LLM_BASE_URL,
  );
  const embeddings = hasEmbeddingProvider ? await tryLoadEmbeddings(username) : null;

  const { messages }: { messages: UIMessage[] } = await req.json();
  const modelMessages = await convertToModelMessages(messages);
  const queryText = extractLastUserText(messages);

  // Retrieval + risk classification run in parallel so the classifier doesn't
  // add latency to ordinary chats.
  const retrievalPromise = (async () => {
    if (!queryText) return [] as Tweet[];
    try {
      let queryVec: Float32Array | null = null;
      if (embeddings) {
        queryVec = await embedQuery(queryText);
      }
      const topIds = hybridTopK(embeddings, queryVec, bundle.bm25, queryText, TOP_K);
      return topIds
        .map((id) => bundle.tweetById.get(id))
        .filter((t): t is Tweet => Boolean(t));
    } catch (err) {
      console.error('Retrieval failed, falling back to voice-only:', err);
      return [] as Tweet[];
    }
  })();
  const riskPromise = queryText ? classifyRisk(queryText) : Promise.resolve(null);
  const [retrievedTweets, riskCategory] = await Promise.all([
    retrievalPromise,
    riskPromise,
  ]);

  // Prior-only personas have no corpus to retrieve from; the static prompt
  // already explains that to the model, so injecting an empty retrieval
  // block ("answer from voice signature alone") would just contradict it.
  const isPriorOnly = bundle.corpus.mode === 'prior-only';
  const retrievalBlock = isPriorOnly ? '' : buildRetrievalBlock(retrievedTweets);
  const augmentedMessages = isPriorOnly
    ? modelMessages
    : injectRetrievalIntoLastUserMessage(modelMessages, retrievalBlock);

  // Risk disclaimer goes in the SYSTEM channel — never the user channel —
  // so the persona doesn't read it as prompt injection and refuse to follow.
  // Cost: cache miss on the persona's static prompt for this turn only.
  const riskAddendum = riskSystemAddendumFor(riskCategory);
  const systemPrompt = riskAddendum
    ? `${bundle.staticPrompt}\n\n${riskAddendum}`
    : bundle.staticPrompt;

  const retrievedMeta = retrievedTweets.map((t) => ({
    id: t.id,
    text: t.text,
    url: t.url,
    createdAt: t.createdAt,
    source: t.source ?? 'tweet',
    title: t.title,
  }));

  const result = streamText({
    model: modelFor('chat'),
    system: systemPrompt,
    messages: augmentedMessages,
    providerOptions: cacheableProviderOptions(),
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type === 'start') {
        return { retrievedTweets: retrievedMeta };
      }
    },
  });
}
