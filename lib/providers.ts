/**
 * Typed registry describing what each LLM provider can do.
 *
 * Single source of truth for: supported roles, default models per role,
 * whether the provider does prompt caching, whether it can also serve
 * embeddings, and the per-call provider-specific option shapes.
 *
 * Env still picks WHICH provider is active (`LLM_PROVIDER`,
 * `EMBEDDING_PROVIDER`). The registry says what each one is capable of.
 * Adding a new provider is a new entry in PROVIDERS plus optional alias
 * entries — no edits to `lib/llm.ts` or to routes.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { EmbeddingModel, LanguageModel } from 'ai';

export type Role = 'chat' | 'gate' | 'classifier' | 'judge';
export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

export type EmbeddingOptionsInput = { dimensions: number };

export type ProviderSpec = {
  id: ProviderId;
  /** Aliases users may set in LLM_PROVIDER or EMBEDDING_PROVIDER. */
  aliases: readonly string[];
  defaultModels: Record<Role, string>;
  supportsCaching: boolean;
  supportsEmbeddings: boolean;
  defaultEmbeddingModel?: string;
  /** Build a LanguageModel for the given model id. */
  language(modelId: string): LanguageModel;
  /** Build an EmbeddingModel. Only populated when supportsEmbeddings. */
  embedding?(modelId: string): EmbeddingModel;
  /** Provider-specific options for streamText / generateText. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cacheableProviderOptions(): Record<string, any> | undefined;
  /** Provider-specific options for embed() (e.g. OpenAI's `dimensions`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embeddingProviderOptions?(input: EmbeddingOptionsInput): Record<string, any> | undefined;
};

// Two compatible-client caches because LLM_BASE_URL and EMBEDDING_BASE_URL
// can point at different servers.
let llmCC: ReturnType<typeof createOpenAICompatible> | null = null;
let embedCC: ReturnType<typeof createOpenAICompatible> | null = null;

function llmCompatibleClient(): ReturnType<typeof createOpenAICompatible> {
  if (llmCC) return llmCC;
  const baseURL = process.env.LLM_BASE_URL;
  if (!baseURL) {
    throw new Error(
      'LLM_PROVIDER=openai-compatible requires LLM_BASE_URL (e.g. http://localhost:11434/v1 for Ollama).',
    );
  }
  llmCC = createOpenAICompatible({
    name: 'wwxd-llm',
    baseURL,
    apiKey: process.env.LLM_API_KEY,
  });
  return llmCC;
}

function embeddingCompatibleClient(): ReturnType<typeof createOpenAICompatible> {
  if (embedCC) return embedCC;
  const baseURL = process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL;
  if (!baseURL) {
    throw new Error(
      'EMBEDDING_PROVIDER=openai-compatible requires EMBEDDING_BASE_URL (or LLM_BASE_URL).',
    );
  }
  embedCC = createOpenAICompatible({
    name: 'wwxd-embed',
    baseURL,
    apiKey: process.env.EMBEDDING_API_KEY ?? process.env.LLM_API_KEY,
  });
  return embedCC;
}

/**
 * Drop both memoized openai-compatible clients. Used by tests that flip
 * env vars between assertions; not intended for production callers.
 */
export function __resetClients(): void {
  llmCC = null;
  embedCC = null;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    aliases: [],
    defaultModels: {
      chat: 'claude-opus-4-7',
      gate: 'claude-haiku-4-5-20251001',
      classifier: 'claude-haiku-4-5-20251001',
      judge: 'claude-opus-4-7',
    },
    supportsCaching: true,
    supportsEmbeddings: false,
    language: (id) => anthropic(id),
    cacheableProviderOptions: () => ({
      anthropic: { cacheControl: { type: 'ephemeral' as const } },
    }),
  },
  openai: {
    id: 'openai',
    aliases: [],
    defaultModels: {
      chat: 'gpt-5',
      gate: 'gpt-5-mini',
      classifier: 'gpt-5-mini',
      judge: 'gpt-5',
    },
    supportsCaching: false,
    supportsEmbeddings: true,
    defaultEmbeddingModel: 'text-embedding-3-small',
    language: (id) => openai(id),
    embedding: (id) => openai.textEmbedding(id),
    cacheableProviderOptions: () => undefined,
    embeddingProviderOptions: ({ dimensions }) => ({ openai: { dimensions } }),
  },
  'openai-compatible': {
    id: 'openai-compatible',
    aliases: ['ollama', 'openrouter', 'vllm', 'lmstudio'],
    defaultModels: {
      chat: 'llama3.1:8b',
      gate: 'llama3.1:8b',
      classifier: 'llama3.1:8b',
      judge: 'llama3.1:8b',
    },
    supportsCaching: false,
    supportsEmbeddings: true,
    language: (id) => llmCompatibleClient()(id),
    embedding: (id) => embeddingCompatibleClient().textEmbeddingModel(id),
    cacheableProviderOptions: () => undefined,
  },
};

/**
 * Resolve a raw env string ("anthropic", "ollama", "OPENAI", undefined) to
 * a spec. Throws on unknown values. Defaults to anthropic when raw is
 * undefined (matches the historical LLM_PROVIDER default).
 */
export function resolveProvider(raw?: string): ProviderSpec {
  const candidate = (raw ?? 'anthropic').toLowerCase();
  for (const spec of Object.values(PROVIDERS)) {
    if (spec.id === candidate) return spec;
    if (spec.aliases.includes(candidate)) return spec;
  }
  const supported = Object.values(PROVIDERS)
    .map((p) => p.id)
    .join(' | ');
  throw new Error(`Unknown provider: ${candidate}. Use one of: ${supported}.`);
}
