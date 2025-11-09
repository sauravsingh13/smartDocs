import { NextResponse } from 'next/server';
import { embedQuery, topK } from '../../../lib/rag';
import { getAll } from '../../../lib/store';

type QA = { q: string; mustInclude: string[] };

type EvalResult = {
  question: string;
  retrieved: { source: string; page: number }[];
  passed: boolean;
};

// Add or modify to your docs
const SAMPLE_QA: QA[] = [
  { q: "What is the document about?", mustInclude: ["about", "purpose", "summary"] },
  { q: "Who is the issuer or organization?", mustInclude: ["company", "organization", "issuer"] },
  { q: "List key dates mentioned.", mustInclude: ["date", "202", "20"] }
];

export const runtime = 'nodejs';

export async function GET() {
  const store = await getAll();
  if (store.chunks.length === 0) {
    return NextResponse.json({ error: 'No documents ingested.' }, { status: 400 });
  }

  const results: EvalResult[] = [];
  let hits = 0;

  for (const qa of SAMPLE_QA) {
    const qEmb = await embedQuery(qa.q);
    const idxs = topK(qEmb, store.embeddings, 4);
    const context = idxs.map(i => store.chunks[i].text.toLowerCase()).join(" ");
    const ok = qa.mustInclude.some(k => context.includes(k.toLowerCase()));
    if (ok) hits += 1;
    results.push({
      question: qa.q,
      retrieved: idxs.map(i => ({ source: store.chunks[i].source, page: store.chunks[i].page })),
      passed: ok
    });
  }

  return NextResponse.json({
    k: 4,
    total: SAMPLE_QA.length,
    passed: hits,
    recall_at_k: hits / SAMPLE_QA.length,
    results
  });
}
