export type Bm25Index = {
  totalDocs: number;
  avgDocLength: number;
  docLengths: number[];
  termDocFreq: Map<string, number>;
  docTerms: Map<string, number>[];
  ids: string[];
};

const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9_@'\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function buildBm25(docs: { id: string; text: string }[]): Bm25Index {
  const ids: string[] = [];
  const docLengths: number[] = [];
  const docTerms: Map<string, number>[] = [];
  const termDocFreq = new Map<string, number>();

  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    for (const term of tf.keys()) {
      termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
    }
    ids.push(doc.id);
    docLengths.push(tokens.length);
    docTerms.push(tf);
  }

  const totalDocs = docs.length;
  const totalLen = docLengths.reduce((a, b) => a + b, 0);
  const avgDocLength = totalDocs > 0 ? totalLen / totalDocs : 0;

  return { totalDocs, avgDocLength, docLengths, termDocFreq, docTerms, ids };
}

export function bm25Score(query: string, index: Bm25Index): Map<string, number> {
  const queryTerms = tokenize(query);
  const scores = new Map<string, number>();
  const { totalDocs, avgDocLength, docLengths, termDocFreq, docTerms, ids } = index;
  if (totalDocs === 0 || avgDocLength === 0) return scores;

  for (const term of queryTerms) {
    const df = termDocFreq.get(term) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    for (let i = 0; i < ids.length; i += 1) {
      const tf = docTerms[i].get(term) ?? 0;
      if (tf === 0) continue;
      const docLen = docLengths[i];
      const norm = 1 - B + B * (docLen / avgDocLength);
      const score = (idf * tf * (K1 + 1)) / (tf + K1 * norm);
      scores.set(ids[i], (scores.get(ids[i]) ?? 0) + score);
    }
  }

  return scores;
}

export function bm25TopK(query: string, index: Bm25Index, k: number): string[] {
  const scores = bm25Score(query, index);
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}
