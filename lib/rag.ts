import { JinaEmbeddings } from "@langchain/community/embeddings/jina";
import type { Chunk } from "./store";

let embedder: JinaEmbeddings | null = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = new JinaEmbeddings({
      apiKey: process.env.JINA_API_KEY!,
      model: process.env.JINA_EMBED_MODEL || "jina-embeddings-v3",
    });
  }
  console.log(process.env.JINA_API_KEY, process.env.JINA_EMBED_MODEL);
  return embedder;
}

export function chunkPage(pageText: string, source: string, page: number, chunkSize = 800, overlap = 200) {
  const clean = pageText.replace(/\s+/g, " ").trim();
  const chunks: Chunk[] = [];
  for (let i = 0; i < clean.length; i += Math.max(1, chunkSize - overlap)) {
    const text = clean.slice(i, i + chunkSize);
    chunks.push({ text, source, page });
  }
  return chunks;
}

export async function embedTextsFromChunks(chunks: Chunk[]): Promise<number[][]> {
  const e = await getEmbedder();
  return await e.embedDocuments(chunks.map(c => c.text));
}

export async function embedQuery(q: string): Promise<number[]> {
  const e = await getEmbedder();
  return await e.embedQuery(q);
}

export function topK(queryEmb: number[], docs: number[][], k = 4): number[] {
  const sims = docs.map((e, i) => ({ i, s: cosine(queryEmb, e) }));
  sims.sort((a, b) => b.s - a.s);
  return sims.slice(0, k).map(x => x.i);
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
