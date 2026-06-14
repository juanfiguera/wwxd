import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROVIDERS,
  __resetClients,
  resolveProvider,
  type ProviderId,
  type Role,
} from '../providers';

const ENV_KEYS = [
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'EMBEDDING_BASE_URL',
  'EMBEDDING_API_KEY',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  __resetClients();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetClients();
});

describe('resolveProvider', () => {
  it('defaults to anthropic when no value is passed', () => {
    expect(resolveProvider().id).toBe('anthropic');
  });

  it('resolves each canonical id', () => {
    const ids: ProviderId[] = ['anthropic', 'openai', 'openai-compatible'];
    for (const id of ids) {
      expect(resolveProvider(id).id).toBe(id);
    }
  });

  it('resolves the openai-compatible aliases', () => {
    for (const alias of ['ollama', 'openrouter', 'vllm', 'lmstudio']) {
      expect(resolveProvider(alias).id).toBe('openai-compatible');
    }
  });

  it('is case-insensitive on the raw value', () => {
    expect(resolveProvider('ANTHROPIC').id).toBe('anthropic');
    expect(resolveProvider('OPENAI').id).toBe('openai');
    expect(resolveProvider('Ollama').id).toBe('openai-compatible');
  });

  it('throws on unknown values with the supported list in the message', () => {
    expect(() => resolveProvider('gemini')).toThrow(/Unknown provider: gemini/);
    expect(() => resolveProvider('gemini')).toThrow(/anthropic \| openai \| openai-compatible/);
  });
});

describe('PROVIDERS registry shape', () => {
  it('declares one default model per role for every provider', () => {
    const roles: Role[] = ['chat', 'gate', 'classifier', 'judge'];
    for (const spec of Object.values(PROVIDERS)) {
      for (const role of roles) {
        const id = spec.defaultModels[role];
        expect(id, `${spec.id}.defaultModels.${role}`).toBeTruthy();
        expect(typeof id).toBe('string');
      }
    }
  });

  it('only anthropic supports prompt caching', () => {
    expect(PROVIDERS.anthropic.supportsCaching).toBe(true);
    expect(PROVIDERS.openai.supportsCaching).toBe(false);
    expect(PROVIDERS['openai-compatible'].supportsCaching).toBe(false);
  });

  it('openai + openai-compatible support embeddings; anthropic does not', () => {
    expect(PROVIDERS.openai.supportsEmbeddings).toBe(true);
    expect(PROVIDERS['openai-compatible'].supportsEmbeddings).toBe(true);
    expect(PROVIDERS.anthropic.supportsEmbeddings).toBe(false);
  });

  it('every embeddings-supporting provider declares an embedding factory', () => {
    for (const spec of Object.values(PROVIDERS)) {
      if (spec.supportsEmbeddings) {
        expect(spec.embedding, `${spec.id}.embedding`).toBeDefined();
      } else {
        expect(spec.embedding, `${spec.id}.embedding`).toBeUndefined();
      }
    }
  });

  it('anthropic spec emits the ephemeral cache control shape', () => {
    expect(PROVIDERS.anthropic.cacheableProviderOptions()).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('openai + openai-compatible specs return undefined cache options', () => {
    expect(PROVIDERS.openai.cacheableProviderOptions()).toBeUndefined();
    expect(PROVIDERS['openai-compatible'].cacheableProviderOptions()).toBeUndefined();
  });

  it('only openai passes a dimensions option to embed()', () => {
    expect(PROVIDERS.openai.embeddingProviderOptions?.({ dimensions: 256 })).toEqual({
      openai: { dimensions: 256 },
    });
    expect(PROVIDERS['openai-compatible'].embeddingProviderOptions).toBeUndefined();
  });

  it('openai-compatible aliases include the common self-hosted backends', () => {
    const aliases = PROVIDERS['openai-compatible'].aliases;
    for (const a of ['ollama', 'openrouter', 'vllm', 'lmstudio']) {
      expect(aliases).toContain(a);
    }
  });
});

describe('language factory error paths', () => {
  it('openai-compatible throws when LLM_BASE_URL is unset', () => {
    delete process.env.LLM_BASE_URL;
    expect(() => PROVIDERS['openai-compatible'].language('llama3.1:8b')).toThrow(/LLM_BASE_URL/);
  });

  it('openai-compatible succeeds once LLM_BASE_URL is set', () => {
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    expect(() => PROVIDERS['openai-compatible'].language('llama3.1:8b')).not.toThrow();
  });
});

describe('embedding factory error paths', () => {
  it('openai-compatible throws when neither EMBEDDING_BASE_URL nor LLM_BASE_URL is set', () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.EMBEDDING_BASE_URL;
    expect(() => PROVIDERS['openai-compatible'].embedding?.('mxbai-embed-large')).toThrow(
      /EMBEDDING_BASE_URL|LLM_BASE_URL/,
    );
  });

  it('openai-compatible falls back to LLM_BASE_URL when EMBEDDING_BASE_URL is unset', () => {
    delete process.env.EMBEDDING_BASE_URL;
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    expect(() => PROVIDERS['openai-compatible'].embedding?.('mxbai-embed-large')).not.toThrow();
  });
});
