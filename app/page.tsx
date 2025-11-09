'use client';

import { useEffect, useRef, useState } from 'react';

type ChatMsg = { role: 'user' | 'assistant', content: string };
type Cite = { text: string; idx: number };

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState('What is the document about?');
  const [busy, setBusy] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function ingest() {
    if (!fileRef.current || !fileRef.current.files?.length) return;
    setIngesting(true);
    const fd = new FormData();
    for (const f of Array.from(fileRef.current.files)) fd.append('files', f);
    const r = await fetch('/api/ingest', { method: 'POST', body: fd });
    const data = await r.json();
    setIngesting(false);
    alert(r.ok ? `Ingested ${data.added} chunks` : `Ingest failed: ${data?.error || 'unknown'}`);
    refreshStatus();
  }

  async function ask() {
    setBusy(true);
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    const data = await r.json();
    setMessages(m => [
      ...m, { role: 'user', content: question },
      { role: 'assistant', content: data.answer + (data.citations?.length ? `\n\nCitations:\n` + data.citations.map((c: Cite, i: number) => `[${i + 1}] ${c.text.slice(0, 120)}...`).join('\n') : '') }
    ]);
    setBusy(false);
  }

  async function refreshStatus() {
    const r = await fetch('/api/status');
    const s = await r.json();
    setChunkCount(s.chunks || 0);
  }

  useEffect(() => { refreshStatus(); }, []);

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 32, fontWeight: 900 }}>SmartDocs — RAG over PDFs</h1>
      <p style={{ color: '#475569' }}>
        Jina embeddings for retrieval • OpenRouter for chat • Citations from your PDFs
      </p>

      <div style={{ marginTop: 16, padding: 16, background: 'white', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <h3>1) Ingest PDFs</h3>
        <input ref={fileRef} type="file" multiple accept="application/pdf" />
        <button onClick={ingest} disabled={ingesting} style={{ marginLeft: 8 }}>
          {ingesting ? 'Ingesting...' : 'Ingest'}
        </button>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Chunks indexed: {chunkCount}</p>
      </div>

      <div style={{ marginTop: 16, padding: 16, background: 'white', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <h3>2) Ask a question</h3>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={question} onChange={e => setQuestion(e.target.value)} style={{ flex: 1 }} />
          <button onClick={ask} disabled={busy}>{busy ? 'Thinking...' : 'Ask'}</button>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', background: m.role === 'assistant' ? '#f1f5f9' : '#fff', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <strong>{m.role === 'assistant' ? 'Assistant' : 'You'}: </strong>{m.content}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
