import { promises as fs } from 'fs';
import path from 'path';

type Store = { texts: string[]; embeddings: number[][] };

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return JSON.parse(raw) as Store;
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const empty: Store = { texts: [], embeddings: [] };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
}

export async function saveStore(store: Store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store), 'utf8');
}
