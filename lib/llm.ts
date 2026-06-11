/**
 * Single source of truth for which LLM provider answers each role
 * (chat, gate, risk classifier, eval judge) and which provider supplies
 * embeddings. Lets self-hosters point wwxd at Anthropic, OpenAI, Ollama,
 * OpenRouter, vLLM, or any OpenAI-compatible API by editing `.env.local`,
 * never the code.
 *
 * Env contract:
 *
 *   LLM_PROVIDER          = anthropic | openai | openai-compatible   (default: anthropic)
 *   LLM_BASE_URL          = base URL for openai-compatible (Ollama: http://localhost:11434/v1)
 *   LLM_API_KEY           = API key for openai-compatible (Ollama: "ollama")
 *
 *   CHAT_MODEL            = model id for the main persona reply
 *   GATE_MODEL            = model id for the roundtable speaker gate (cheap)
 *   CLASSIFIER_MODEL      = model id for the risk classifier (cheap)
 *   JUDGE_MODEL           = model id for offline eval judges
 *
 *   EMBEDDING_PROVIDER    = openai | openai-compatible                (default: openai)
 *   EMBEDDING_BASE_URL    = base URL for openai-compatible embeddings
 *   EMBEDDING_API_KEY     = API key for openai-compatible embeddings
 *   EMBEDDING_MODEL       = model id (default: text-embedding-3-small)
 *   EMBEDDING_DIMENSIONS  = output dims (default: 512)
 *
 * All MODEL ids fall back to per-provider defaults below if unset, so a
 * minimal `.env.local` with just `LLM_PROVIDER=openai` and the
 * corresponding API key works out of the box.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { EmbeddingModel, LanguageModel } from 'ai';

export type Role = 'chat' | 'gate' | 'classifier' | 'judge';

type Provider = 'anthropic' | 'openai' | 'openai-compatible';

function provider(): Provider {
  const raw = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  if (raw === 'anthropic' || raw === 'openai' || raw === 'openai-compatible') {
    return raw;
  }
  // Friendly aliases.
  if (raw === 'ollama' || raw === 'openrouter' || raw === 'vllm' || raw === 'lmstudio') {
    return 'openai-compatible';
  }
  throw new Error(
    `Unknown LLM_PROVIDER=${raw}. Use anthropic | openai | openai-compatible.`,
  );
}

/** Built-in defaults so a brand-new `.env.local` with just LLM_PROVIDER works. */
const DEFAULT_MODELS: Record<Provider, Record<Role, string>> = {
  anthropic: {
    chat: 'claude-opus-4-7',
    gate: 'claude-haiku-4-5-20251001',
    classifier: 'claude-haiku-4-5-20251001',
    judge: 'claude-opus-4-7',
  },
  openai: {
    chat: 'gpt-5',
    gate: 'gpt-5-mini',
    classifier: 'gpt-5-mini',
    judge: 'gpt-5',
  },
  'openai-compatible': {
    // Ollama defaults; override per-role via env.
    chat: 'llama3.1:8b',
    gate: 'llama3.1:8b',
    classifier: 'llama3.1:8b',
    judge: 'llama3.1:8b',
  },
};

function envFor(role: Role): string {
  switch (role) {
    case 'chat':
      return process.env.CHAT_MODEL ?? DEFAULT_MODELS[provider()][role];
    case 'gate':
      return process.env.GATE_MODEL ?? DEFAULT_MODELS[provider()][role];
    case 'classifier':
      return process.env.CLASSIFIER_MODEL ?? DEFAULT_MODELS[provider()][role];
    case 'judge':
      return process.env.JUDGE_MODEL ?? DEFAULT_MODELS[provider()][role];
  }
}

let openaiCompatibleClient: ReturnType<typeof createOpenAICompatible> | null = null;
function getOpenAICompatibleClient() {
  if (openaiCompatibleClient) return openaiCompatibleClient;
  const baseURL = process.env.LLM_BASE_URL;
  if (!baseURL) {
    throw new Error(
      'LLM_PROVIDER=openai-compatible requires LLM_BASE_URL (e.g. http://localhost:11434/v1 for Ollama).',
    );
  }
  openaiCompatibleClient = createOpenAICompatible({
    name: 'wwxd-llm',
    baseURL,
    apiKey: process.env.LLM_API_KEY,
  });
  return openaiCompatibleClient;
}

/** Factory that returns the LanguageModel for a given role. */
export function modelFor(role: Role): LanguageModel {
  const id = envFor(role);
  switch (provider()) {
    case 'anthropic':
      return anthropic(id);
    case 'openai':
      return openai(id);
    case 'openai-compatible':
      return getOpenAICompatibleClient()(id);
  }
}

/**
 * Provider-specific provider options for streamText/generateText. Anthropic
 * supports prompt caching via `cacheControl`; OpenAI and most
 * openai-compatible backends don't, so we just don't pass it.
 */
export function cacheableProviderOptions() {
  if (provider() === 'anthropic') {
    return { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Embeddings

type EmbeddingProvider = 'openai' | 'openai-compatible';

function embeddingProvider(): EmbeddingProvider {
  const raw = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase();
  if (raw === 'openai' || raw === 'openai-compatible') return raw;
  if (raw === 'ollama') return 'openai-compatible';
  throw new Error(
    `Unknown EMBEDDING_PROVIDER=${raw}. Use openai | openai-compatible.`,
  );
}

let embeddingCompatibleClient: ReturnType<typeof createOpenAICompatible> | null = null;
function getEmbeddingCompatibleClient() {
  if (embeddingCompatibleClient) return embeddingCompatibleClient;
  const baseURL = process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL;
  if (!baseURL) {
    throw new Error(
      'EMBEDDING_PROVIDER=openai-compatible requires EMBEDDING_BASE_URL (or LLM_BASE_URL).',
    );
  }
  embeddingCompatibleClient = createOpenAICompatible({
    name: 'wwxd-embed',
    baseURL,
    apiKey: process.env.EMBEDDING_API_KEY ?? process.env.LLM_API_KEY,
  });
  return embeddingCompatibleClient;
}

export function embeddingModelId(): string {
  return process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
}

export function embeddingDimensions(): number {
  return Number(process.env.EMBEDDING_DIMENSIONS ?? '512');
}

export function embeddingModel(): EmbeddingModel {
  const id = embeddingModelId();
  switch (embeddingProvider()) {
    case 'openai':
      return openai.textEmbedding(id);
    case 'openai-compatible':
      return getEmbeddingCompatibleClient().textEmbeddingModel(id);
  }
}

/**
 * Returns the provider-specific options needed when embedding (currently just
 * OpenAI's `dimensions` knob for `text-embedding-3-*`). openai-compatible
 * backends like Ollama don't accept this and would 400, so omit there.
 */
export function embeddingProviderOptions() {
  if (embeddingProvider() === 'openai') {
    return { openai: { dimensions: embeddingDimensions() } };
  }
  return undefined;
}

/** For logging / health-check / debug. */
export function describeProvider(): { llm: string; embedding: string } {
  return { llm: provider(), embedding: embeddingProvider() };
}
