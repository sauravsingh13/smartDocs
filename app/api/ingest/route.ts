import { NextResponse } from 'next/server';
import pdf from 'pdf-parse';
import { chunkText, embedTexts } from '../../../lib/rag';
import { loadStore, saveStore } from '../../../lib/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll('files') as File[];
  if (!files.length) return NextResponse.json({ error: 'No files' }, { status: 400 });

  const texts: string[] = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const data = await pdf(buf);
    texts.push(data.text);
  }

  const chunks = chunkText(texts.join('\n\n'), 800, 200);
  const embeddings = await embedTexts(chunks);

  const store = await loadStore();
  store.texts.push(...chunks);
  store.embeddings.push(...embeddings);
  await saveStore(store);

  return NextResponse.json({ ok: true, added: chunks.length });
}
