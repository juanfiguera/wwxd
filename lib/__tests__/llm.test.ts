import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheableProviderOptions,
  describeProvider,
  embeddingDimensions,
  embeddingModel,
  embeddingModelId,
  embeddingProviderOptions,
  modelFor,
  type Role,
} from '../llm';

const ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'CHAT_MODEL',
  'GATE_MODEL',
  'CLASSIFIER_MODEL',
  'JUDGE_MODEL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_BASE_URL',
  'EMBEDDING_API_KEY',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('modelFor', () => {
  it('returns a model for each role under the anthropic default', () => {
    delete process.env.LLM_PROVIDER;
    for (const role of ['chat', 'gate', 'classifier', 'judge'] as Role[]) {
      expect(modelFor(role)).toBeTruthy();
    }
  });

  it('returns a model for each role with openai', () => {
    process.env.LLM_PROVIDER = 'openai';
    for (const role of ['chat', 'gate', 'classifier', 'judge'] as Role[]) {
      expect(modelFor(role)).toBeTruthy();
    }
  });

  it('throws if openai-compatible is selected without LLM_BASE_URL', () => {
    process.env.LLM_PROVIDER = 'openai-compatible';
    delete process.env.LLM_BASE_URL;
    expect(() => modelFor('chat')).toThrow(/LLM_BASE_URL/);
  });

  it('accepts openai-compatible aliases (ollama, openrouter, vllm, lmstudio)', () => {
    for (const alias of ['ollama', 'openrouter', 'vllm', 'lmstudio']) {
      process.env.LLM_PROVIDER = alias;
      process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
      expect(modelFor('chat')).toBeTruthy();
    }
  });

  it('rejects unknown providers', () => {
    process.env.LLM_PROVIDER = 'gemini-or-bust';
    expect(() => modelFor('chat')).toThrow(/Unknown LLM_PROVIDER/);
  });
});

describe('cacheableProviderOptions', () => {
  it('returns anthropic cacheControl only when provider is anthropic', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    expect(cacheableProviderOptions()).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('returns undefined for openai', () => {
    process.env.LLM_PROVIDER = 'openai';
    expect(cacheableProviderOptions()).toBeUndefined();
  });

  it('returns undefined for openai-compatible', () => {
    process.env.LLM_PROVIDER = 'openai-compatible';
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    expect(cacheableProviderOptions()).toBeUndefined();
  });
});

describe('embeddingProviderOptions', () => {
  it('sends dimensions only for openai', () => {
    process.env.EMBEDDING_PROVIDER = 'openai';
    process.env.EMBEDDING_DIMENSIONS = '256';
    expect(embeddingProviderOptions()).toEqual({ openai: { dimensions: 256 } });
  });

  it('returns undefined for openai-compatible (Ollama would 400 on dimensions)', () => {
    process.env.EMBEDDING_PROVIDER = 'openai-compatible';
    process.env.EMBEDDING_BASE_URL = 'http://localhost:11434/v1';
    expect(embeddingProviderOptions()).toBeUndefined();
  });
});

describe('embeddingModel', () => {
  it('returns an OpenAI model under defaults', () => {
    delete process.env.EMBEDDING_PROVIDER;
    expect(embeddingModel()).toBeTruthy();
  });

  it('throws if openai-compatible is selected without a base URL', () => {
    process.env.EMBEDDING_PROVIDER = 'openai-compatible';
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.LLM_BASE_URL;
    expect(() => embeddingModel()).toThrow(/EMBEDDING_BASE_URL|LLM_BASE_URL/);
  });

  it('falls back to LLM_BASE_URL when EMBEDDING_BASE_URL is unset', () => {
    process.env.EMBEDDING_PROVIDER = 'openai-compatible';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    expect(embeddingModel()).toBeTruthy();
  });
});

describe('embedding defaults', () => {
  it('embeddingModelId defaults to text-embedding-3-small', () => {
    delete process.env.EMBEDDING_MODEL;
    expect(embeddingModelId()).toBe('text-embedding-3-small');
  });

  it('embeddingDimensions defaults to 512', () => {
    delete process.env.EMBEDDING_DIMENSIONS;
    expect(embeddingDimensions()).toBe(512);
  });

  it('honors EMBEDDING_MODEL + EMBEDDING_DIMENSIONS', () => {
    process.env.EMBEDDING_MODEL = 'mxbai-embed-large';
    process.env.EMBEDDING_DIMENSIONS = '1024';
    expect(embeddingModelId()).toBe('mxbai-embed-large');
    expect(embeddingDimensions()).toBe(1024);
  });
});

describe('describeProvider', () => {
  it('reports both LLM + embedding selections', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.EMBEDDING_PROVIDER = 'openai';
    expect(describeProvider()).toEqual({ llm: 'openai', embedding: 'openai' });
  });

  it('normalizes ollama → openai-compatible in the report', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    process.env.EMBEDDING_PROVIDER = 'ollama';
    expect(describeProvider().llm).toBe('openai-compatible');
    expect(describeProvider().embedding).toBe('openai-compatible');
  });
});
