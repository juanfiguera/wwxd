import { embed } from 'ai';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bm25TopK, type Bm25Index } from './bm25';
import { embeddingModel, embeddingProviderOptions } from './llm';

const RRF_K = 60;

type EmbeddingFileItem = { id: string; embedding: number[] };
type EmbeddingFile = {
  model: string;
  dimensions: number;
  createdAt: string;
  items: EmbeddingFileItem[];
};

export type LoadedEmbeddings = {
  model: string;
  dimensions: number;
  ids: string[];
  vectors: Float32Array;
};

const cache = new Map<string, { mtime: number; loaded: LoadedEmbeddings }>();

export function embeddingsPath(username: string): string {
  const dir = process.env.WWXD_DATA_DIR ?? resolve(process.cwd(), 'data');
  return resolve(dir, `${username}.embeddings.json`);
}

export async function loadEmbeddings(username: string): Promise<LoadedEmbeddings> {
  const path = embeddingsPath(username);
  const { mtimeMs } = await stat(path);
  const cached = cache.get(username);
  if (cached && cached.mtime === mtimeMs) return cached.loaded;

  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as EmbeddingFile;
  const n = parsed.items.length;
  const d = parsed.dimensions;
  const vectors = new Float32Array(n * d);
  const ids: string[] = new Array(n);

  for (let i = 0; i < n; i += 1) {
    const item = parsed.items[i];
    ids[i] = item.id;
    for (let j = 0; j < d; j += 1) {
      vectors[i * d + j] = item.embedding[j];
    }
  }

  const loaded: LoadedEmbeddings = { model: parsed.model, dimensions: d, ids, vectors };
  cache.set(username, { mtime: mtimeMs, loaded });
  return loaded;
}

export async function embedQuery(query: string): Promise<Float32Array> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: query,
    providerOptions: embeddingProviderOptions(),
  });
  return Float32Array.from(embedding);
}

export function topK(query: Float32Array, embeddings: LoadedEmbeddings, k: number): string[] {
  const { ids, vectors, dimensions: d } = embeddings;
  const n = ids.length;
  const scores: { id: string; score: number }[] = new Array(n);

  for (let i = 0; i < n; i += 1) {
    let dot = 0;
    const offset = i * d;
    for (let j = 0; j < d; j += 1) {
      dot += vectors[offset + j] * query[j];
    }
    scores[i] = { id: ids[i], score: dot };
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k).map((s) => s.id);
}

export function reciprocalRankFusion(rankings: string[][], k: number): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i += 1) {
      const id = ranking[i];
      const inc = 1 / (RRF_K + i + 1);
      scores.set(id, (scores.get(id) ?? 0) + inc);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}

export function hybridTopK(
  embeddings: LoadedEmbeddings | null,
  queryVec: Float32Array | null,
  bm25Index: Bm25Index | null,
  queryText: string,
  k: number,
): string[] {
  const rankings: string[][] = [];
  if (embeddings && queryVec) rankings.push(topK(queryVec, embeddings, k * 2));
  if (bm25Index) rankings.push(bm25TopK(queryText, bm25Index, k * 2));
  if (rankings.length === 0) return [];
  if (rankings.length === 1) return rankings[0].slice(0, k);
  return reciprocalRankFusion(rankings, k);
}
