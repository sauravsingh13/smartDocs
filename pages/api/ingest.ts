// pages/api/ingest.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

export const config = { api: { bodyParser: false } };

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB/file
const MAX_PSEUDO_PAGES = 120;            // cap page-like blocks per file
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 64;                  // batch embeddings to avoid spikes

// ---- utils ----
function normWhitespace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}
function sha1(s: string) {
  return createHash("sha1").update(s).digest("hex");
}
function splitIntoBlocks(text: string) {
  // split by blank lines as “pseudo-pages”
  return text.split(/\n\s*\n/g).map(normWhitespace).filter(Boolean);
}
function chunkPage(
  pageText: string,
  source: string,
  page: number,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
) {
  const clean = normWhitespace(pageText);
  const chunks: { text: string; source: string; page: number }[] = [];
  if (!clean) return chunks;
  const step = Math.max(1, chunkSize - overlap);
  for (let i = 0; i < clean.length; i += step) {
    chunks.push({ text: clean.slice(i, i + chunkSize), source, page });
  }
  return chunks;
}

async function parseForm(req: NextApiRequest) {
  const uploadDir = path.join(os.tmpdir(), "smartdocs_tmp_uploads");
  await fs.mkdir(uploadDir, { recursive: true });

  const form = formidable({
    multiples: true,
    uploadDir,
    keepExtensions: true,
    maxFileSize: MAX_FILE_BYTES,
    // Hard filter to PDFs only
    filter: (part) => {
      const ok =
        (part.mimetype && part.mimetype.includes("pdf")) ||
        (part.originalFilename && part.originalFilename.toLowerCase().endsWith(".pdf"));
      if (!ok) console.warn("Rejected non-PDF:", part.mimetype, part.originalFilename);
      return ok;
    },
  });

  return new Promise<{ files: FormidableFile[] }>((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err);
      const toA = (f: any) => (Array.isArray(f) ? f : f ? [f] : []);
      const all = Object.values(files).flatMap(toA) as FormidableFile[];
      resolve({ files: all });
    });
  });
}

// ---- handler ----
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { files } = await parseForm(req);
    if (!files.length) return res.status(400).json({ error: "No files" });

    // Lazy-import to dodge ESM/CJS quirkiness
    const _mod: any = await import("pdf-parse");
    const pdf: (buf: Buffer) => Promise<any> = _mod?.default || _mod;
    if (typeof pdf !== "function") {
      return res.status(500).json({ error: "pdf-parse is not a callable module" });
    }

    // Use your Mongoose store API
    const { appendChunksEmbeddings } = await import("../../lib/store");
    const { embedTextsFromChunks } = await import("../../lib/rag");

    const allChunks: Array<{ text: string; source: string; page: number }> = [];
    const seen = new Set<string>(); // de-dupe identical chunks across files

    for (const f of files) {
      const tmpPath = (f as any).filepath as string;
      const filename = path.basename((f.originalFilename as string) || tmpPath);
      try {
        const buf = await fs.readFile(tmpPath);
        // Soft size check (formidable already enforced)
        if (buf.byteLength > MAX_FILE_BYTES) {
          console.warn("Skipping too-large file:", filename);
          continue;
        }

        const result = await pdf(buf);
        const fullText = normWhitespace((result?.text || "").toString());
        if (!fullText) {
          console.warn("Empty text after parsing:", filename);
          continue;
        }

        const blocks = splitIntoBlocks(fullText);
        if (!blocks.length) {
          // fallback: one page-like block
          for (const c of chunkPage(fullText, filename, 1)) {
            const key = sha1(`${c.source}|${c.page}|${c.text}`);
            if (!seen.has(key)) {
              seen.add(key);
              allChunks.push(c);
            }
          }
        } else {
          const limit = Math.min(blocks.length, MAX_PSEUDO_PAGES);
          for (let i = 0; i < limit; i++) {
            const pageText = blocks[i];
            for (const c of chunkPage(pageText, filename, i + 1)) {
              const key = sha1(`${c.source}|${c.page}|${c.text}`);
              if (!seen.has(key)) {
                seen.add(key);
                allChunks.push(c);
              }
            }
          }
        }
      } finally {
        // best-effort cleanup
        if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
      }
    }

    if (!allChunks.length) {
      return res.status(400).json({ error: "No readable text extracted" });
    }

    // Embed in small batches to reduce spikes
    let totalAdded = 0;
    for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
      const batch = allChunks.slice(i, i + EMBED_BATCH);
      const embeddings = await embedTextsFromChunks(batch);
      await appendChunksEmbeddings(batch, embeddings);
      totalAdded += batch.length;
    }

    return res.json({ ok: true, added: totalAdded });
  } catch (e: any) {
    console.error("Ingest error:", e);
    return res.status(500).json({ error: e?.message || "Ingest failed" });
  }
}
