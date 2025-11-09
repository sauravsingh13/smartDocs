// lib/models.ts
import { Schema, models, model, InferSchemaType } from "mongoose";
import { dbConnect } from "./mongoose";

// Chunk: text + source + page + idx (aligned with embedding)
const ChunkSchema = new Schema(
  {
    text: { type: String, required: true },
    source: { type: String, required: true },
    page: { type: Number, required: true },
    idx: { type: Number, required: true, index: true },
  },
  { timestamps: false, versionKey: false }
);

// Embedding: vector + idx (to align with chunk)
const EmbeddingSchema = new Schema(
  {
    vec: { type: [Number], required: true },
    idx: { type: Number, required: true, index: true },
  },
  { timestamps: false, versionKey: false }
);

export type ChunkDoc = InferSchemaType<typeof ChunkSchema>;
export type EmbeddingDoc = InferSchemaType<typeof EmbeddingSchema>;

export async function getModels() {
  await dbConnect();
  const chunkName = process.env.MONGODB_COLL_CHUNKS || "chunks";
  const embName = process.env.MONGODB_COLL_EMBEDDINGS || "embeddings";

  const Chunk = (models[chunkName] as any) || model(chunkName, ChunkSchema, chunkName);
  const Embedding = (models[embName] as any) || model(embName, EmbeddingSchema, embName);

  return { Chunk, Embedding };
}
