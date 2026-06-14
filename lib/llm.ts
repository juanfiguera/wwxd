/**
 * Thin selector layer over `lib/providers.ts`. Reads env to pick the active
 * provider and per-role model id, then delegates to the spec for everything
 * else (LanguageModel factory, EmbeddingModel factory, provider-specific
 * options).
 *
 * Env contract:
 *
 *   LLM_PROVIDER          = anthropic | openai | openai-compatible
 *                           (aliases: ollama, openrouter, vllm, lmstudio)
 *                           (default: anthropic)
 *   LLM_BASE_URL          = base URL for openai-compatible chat (Ollama: http://localhost:11434/v1)
 *   LLM_API_KEY           = API key for openai-compatible chat (Ollama: "ollama")
 *
 *   CHAT_MODEL            = model id for the main persona reply
 *   GATE_MODEL            = model id for the roundtable speaker gate (cheap)
 *   CLASSIFIER_MODEL      = model id for the risk classifier (cheap)
 *   JUDGE_MODEL           = model id for offline eval judges
 *
 *   EMBEDDING_PROVIDER    = openai | openai-compatible (default: openai)
 *   EMBEDDING_BASE_URL    = base URL for openai-compatible embeddings
 *   EMBEDDING_API_KEY     = API key for openai-compatible embeddings
 *   EMBEDDING_MODEL       = model id (default: text-embedding-3-small)
 *   EMBEDDING_DIMENSIONS  = output dims (default: 512)
 *
 * All MODEL ids fall back to per-provider defaults declared in `providers.ts`
 * so a minimal `.env.local` with just `LLM_PROVIDER=openai` and the
 * corresponding API key works out of the box.
 */

import type { EmbeddingModel, LanguageModel } from 'ai';
import { resolveProvider, type ProviderSpec, type Role } from './providers';

export type { Role } from './providers';

const ROLE_ENV: Record<Role, string> = {
  chat: 'CHAT_MODEL',
  gate: 'GATE_MODEL',
  classifier: 'CLASSIFIER_MODEL',
  judge: 'JUDGE_MODEL',
};

function chatProvider(): ProviderSpec {
  return resolveProvider(process.env.LLM_PROVIDER);
}

function embeddingProviderSpec(): ProviderSpec {
  const spec = resolveProvider(process.env.EMBEDDING_PROVIDER ?? 'openai');
  if (!spec.supportsEmbeddings) {
    throw new Error(
      `EMBEDDING_PROVIDER=${spec.id} does not support embeddings. Use openai or openai-compatible.`,
    );
  }
  return spec;
}

function modelIdFor(role: Role): string {
  const override = process.env[ROLE_ENV[role]];
  if (override) return override;
  return chatProvider().defaultModels[role];
}

/** Factory that returns the LanguageModel for a given role. */
export function modelFor(role: Role): LanguageModel {
  return chatProvider().language(modelIdFor(role));
}

/**
 * Provider-specific provider options for streamText/generateText. Anthropic
 * supports prompt caching via `cacheControl`; OpenAI and most
 * openai-compatible backends don't, so we just don't pass it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cacheableProviderOptions(): Record<string, any> | undefined {
  return chatProvider().cacheableProviderOptions();
}

// ─────────────────────────────────────────────────────────────────────────
// Embeddings

export function embeddingModelId(): string {
  if (process.env.EMBEDDING_MODEL) return process.env.EMBEDDING_MODEL;
  return embeddingProviderSpec().defaultEmbeddingModel ?? 'text-embedding-3-small';
}

export function embeddingDimensions(): number {
  return Number(process.env.EMBEDDING_DIMENSIONS ?? '512');
}

export function embeddingModel(): EmbeddingModel {
  const spec = embeddingProviderSpec();
  if (!spec.embedding) {
    // Defensive: supportsEmbeddings should already have caught this.
    throw new Error(`Provider ${spec.id} has no embedding factory.`);
  }
  return spec.embedding(embeddingModelId());
}

/**
 * Returns the provider-specific options needed when embedding (currently just
 * OpenAI's `dimensions` knob for `text-embedding-3-*`). openai-compatible
 * backends like Ollama don't accept this and would 400, so omit there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function embeddingProviderOptions(): Record<string, any> | undefined {
  const spec = embeddingProviderSpec();
  return spec.embeddingProviderOptions?.({ dimensions: embeddingDimensions() });
}

/** For logging / health-check / debug. */
export function describeProvider(): { llm: string; embedding: string } {
  return { llm: chatProvider().id, embedding: embeddingProviderSpec().id };
}
