import { OpenAIEmbeddings } from 'langchain/embeddings/openai';

import { cosineSimilarity } from './similarity';

export function chunkText(text: string, chunkSize = 800, overlap = 200): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + chunkSize, clean.length);
    chunks.push(clean.slice(i, end));
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = new OpenAIEmbeddings({ model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small' });
  return await embedder.embedDocuments(texts);
}

export async function embedQuery(q: string): Promise<number[]> {
  const embedder = new OpenAIEmbeddings({ model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small' });
  return await embedder.embedQuery(q);
}

export function topK(queryEmb: number[], docs: number[][], k = 4): number[] {
  const sims = docs.map((e, i) => ({ i, s: cosineSimilarity(queryEmb, e) }));
  sims.sort((a, b) => b.s - a.s);
  return sims.slice(0, k).map(x => x.i);
}
