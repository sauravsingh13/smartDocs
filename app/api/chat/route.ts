import { NextResponse } from 'next/server';
import { embedQuery, topK } from '../../../lib/rag';
import { loadStore } from '../../../lib/store';
import OpenAI from 'openai';

export const runtime = 'nodejs';

export async function POST(req: Request){
  const { question } = await req.json();
  if(!question) return NextResponse.json({ error:'Missing question' }, { status:400 });

  const store = await loadStore();
  if (store.texts.length === 0) {
    return NextResponse.json({ answer: 'No documents ingested yet. Please upload PDFs first.', citations: [] });
  }

  const qEmb = await embedQuery(question);
  const idxs = topK(qEmb, store.embeddings, 4);
  const context = idxs.map(i => store.texts[i]).join('\n---\n');

  const prompt = `You are a helpful assistant. Using the CONTEXT below, answer the QUESTION. Quote relevant snippets and avoid hallucinating.\n\nCONTEXT:\n${context}\n\nQUESTION: ${question}`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role:'user', content: prompt }],
    temperature: 0.2
  });

  const answer = chat.choices[0]?.message?.content || 'No answer';
  const citations = idxs.map((i,idx)=>({ idx, text: store.texts[i] }));
  return NextResponse.json({ answer, citations });
}
