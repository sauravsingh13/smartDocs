import { promises as fs } from 'fs';
import path from 'path';

export type Chunk = { text: string; source: string; page: number };

type Store = { chunks: Chunk[]; embeddings: number[][] };

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as any;

    // Migrate from older format if needed
    if (Array.isArray(parsed?.texts)) {
      const chunks = (parsed.texts as string[]).map((t, i) => ({
        text: t, source: 'unknown.pdf', page: 1 + (i % 1),
      }));
      return { chunks, embeddings: parsed.embeddings || [] };
    }

    return parsed as Store;
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const empty: Store = { chunks: [], embeddings: [] };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
}

export async function saveStore(store: Store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store), 'utf8');
}
