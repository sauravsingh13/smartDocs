import { NextResponse } from 'next/server';
import axios from 'axios';
import { embedQuery, topK } from '../../../lib/rag';
import { loadStore } from '../../../lib/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { question } = await req.json();
  if (!question) return NextResponse.json({ error: 'Missing question' }, { status: 400 });

  const store = await loadStore();
  if (store.chunks.length === 0) {
    return NextResponse.json({ answer: 'No documents ingested yet. Please upload PDFs first.', citations: [] });
  }

  const qEmb = await embedQuery(question);
  const idxs = topK(qEmb, store.embeddings, 4);
  const picked = idxs.map(i => store.chunks[i]);
  const combinedText = picked.map(c => `[${c.source} p.${c.page}] ${c.text}`).join('\n---\n').slice(0, 8000);

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it:free',
        messages: [
          { role: "system", content: "You are a helpful assistant that answers questions using ONLY the provided context. If missing, say you're unsure and suggest what to upload." },
          { role: "user", content: `Question: ${question}\n\nGiven the following context (with citations):\n\n${combinedText}`.slice(0, 10000) }
        ],
        temperature: 0.2
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
          'X-Title': process.env.OPENROUTER_APP_TITLE || 'SmartDocs RAG Demo'
        },
      }
    );

    const answer = response.data?.choices?.[0]?.message?.content || 'No answer';
    const citations = picked.map((c, i) => ({ idx: i, source: c.source, page: c.page, text: c.text }));
    return NextResponse.json({ answer, citations });
  } catch (err: any) {
    const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || 'OpenRouter error');
    return NextResponse.json({ answer: `OpenRouter error: ${msg}`, citations: [] }, { status: 500 });
  }
}
