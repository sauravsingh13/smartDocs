# 🧠 SmartDocs — RAG over PDFs (Jina + OpenRouter GPT-3.5-Turbo)

> A lightweight **Retrieval-Augmented Generation (RAG)** demo built with **Next.js 14 (App Router)**, **LangChain + Jina Embeddings**, and **OpenRouter GPT-3.5-Turbo** for contextual Q&A over uploaded PDFs.

---

## 🚀 Features

- **📄 PDF Ingestion** using [`pdf-parse`](https://www.npmjs.com/package/pdf-parse)  
  → Converts uploaded PDFs into clean text, chunked into pseudo-pages for citations.
- **🔍 Vector Search** powered by **Jina Embeddings (`jina-embeddings-v3`)** via LangChain.
- **💬 Chat Completion** through **OpenRouter API** (uses GPT-3.5-Turbo).
- **🧩 Local JSON Store** for embeddings (`data/store.json`) — easily replaceable with PGVector or Pinecone.
- **📑 File + Page-Level Citations** (e.g., `[report.pdf p. 4] …`).
- **⚙️ Node-only runtime** (`runtime = "nodejs"`) — deployable on Vercel, Render, or any Node 20+ host.

---

## 🧰 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router) + React 18 |
| Embeddings | LangChain @ Jina Embeddings (`jina-embeddings-v3`) |
| LLM API | OpenRouter (GPT-3.5-Turbo) |
| Storage | Local JSON (`data/store.json`) |
| Parsing | pdf-parse (v2.x) |

---

## 🪜 Quick Start

```bash
# 1. Install dependencies
npm i --legacy-peer-deps

# 2. Copy environment file
cp .env.example .env

# 3. Fill these keys in .env
JINA_API_KEY=jina_xxxxxxxxxxxxxxxxx
JINA_EMBED_MODEL=jina-embeddings-v3

OPENROUTER_API_KEY=or_xxxxxxxxxxxxxxxx
OPENROUTER_MODEL=openai/gpt-3.5-turbo
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_TITLE=SmartDocs RAG Demo

# 4. Run locally
npm run dev
# → http://localhost:3000
