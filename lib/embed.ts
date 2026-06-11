import { embedMany } from 'ai';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  embeddingDimensions,
  embeddingModel,
  embeddingModelId,
  embeddingProviderOptions,
} from './llm';
import { loadCorpus, type Tweet } from './persona';

const BATCH = 200;

type EmbeddingFile = {
  model: string;
  dimensions: number;
  createdAt: string;
  items: { id: string; embedding: number[] }[];
};

export type EmbedProgress =
  | { type: 'start'; total: number; model: string; dimensions: number }
  | { type: 'batch'; done: number; total: number }
  | { type: 'saved'; total: number };

export type EmbedOptions = {
  model?: string;
  dimensions?: number;
};

export async function embedTweets(
  username: string,
  opts: EmbedOptions = {},
  onProgress: (event: EmbedProgress) => void = () => {},
): Promise<{ total: number }> {
  const model = opts.model ?? embeddingModelId();
  const dimensions = opts.dimensions ?? embeddingDimensions();
  const providerOpts = embeddingProviderOptions();

  const corpus = await loadCorpus(username);
  const tweets: Tweet[] = corpus.tweets.filter((t) => t.text.length > 0);
  onProgress({ type: 'start', total: tweets.length, model, dimensions });

  const items: EmbeddingFile['items'] = [];
  for (let i = 0; i < tweets.length; i += BATCH) {
    const slice = tweets.slice(i, i + BATCH);
    const { embeddings } = await embedMany({
      model: embeddingModel(),
      values: slice.map((t) => t.text),
      providerOptions: providerOpts,
    });
    for (let j = 0; j < slice.length; j += 1) {
      items.push({ id: slice[j].id, embedding: embeddings[j] });
    }
    onProgress({ type: 'batch', done: items.length, total: tweets.length });
  }

  const file: EmbeddingFile = {
    model,
    dimensions,
    createdAt: new Date().toISOString(),
    items,
  };

  const outPath = resolve(process.cwd(), 'data', `${username}.embeddings.json`);
  await writeFile(outPath, JSON.stringify(file), 'utf8');
  onProgress({ type: 'saved', total: items.length });
  return { total: items.length };
}
