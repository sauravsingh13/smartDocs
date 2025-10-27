# SmartDocs Q&A — RAG over private PDFs (Next.js + LangChain)

Upload PDFs → chunk + embed → local vector store (JSON) → retrieve top-k → Chat with citations.

## Quickstart
```bash
cp .env.example .env   # add your OpenAI key
npm i
npm run dev   # http://localhost:3000
```

## API
- `POST /api/ingest` — multipart form-data (`files`[]). Parses PDFs, chunks (800/200), embeds via `text-embedding-3-small`, persists to `data/store.json`.
- `POST /api/chat` — `{ question }`. Embeds query, retrieves top-4 by cosine similarity, calls `gpt-4o-mini` with context, returns answer + citations.
- `GET /api/status` — `{ chunks }` count in store.

## Notes
- Persistence is JSON for demo clarity. Swap with a real vector DB (Pinecone, Weaviate, PGVector) by replacing `lib/store.ts` with your adapter.
- Works locally and on servers with write access. For Vercel, use an external DB for persistence.
