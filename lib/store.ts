// lib/store.ts
import { getModels, ChunkDoc } from "./models";

export type Chunk = { text: string; source: string; page: number };

export async function appendChunksEmbeddings(chunks: Chunk[], embeddings: number[][]) {
  const { Chunk, Embedding } = await getModels();
  if (chunks.length !== embeddings.length) {
    throw new Error("chunks.length must equal embeddings.length");
  }
  const now = Date.now();
  const chunkDocs = chunks.map((c, i) => ({ ...c, idx: now + i }));
  const embDocs = embeddings.map((v, i) => ({ vec: v, idx: now + i }));

  // Insert in order; no TX needed for demo
  await Chunk.insertMany(chunkDocs, { ordered: true });
  await Embedding.insertMany(embDocs, { ordered: true });
}

export async function getAll(): Promise<{ chunks: ChunkDoc[]; embeddings: number[][] }> {
  const { Chunk, Embedding } = await getModels();
  const chunks = await Chunk.find({}, { _id: 0 }).sort({ idx: 1 }).lean();
  const embs = await Embedding.find({}, { _id: 0, vec: 1 }).sort({ idx: 1 }).lean();
  return { chunks, embeddings: embs.map((e: any) => e.vec) };
}

export async function countChunks(): Promise<number> {
  const { Chunk } = await getModels();
  return Chunk.estimatedDocumentCount();
}
