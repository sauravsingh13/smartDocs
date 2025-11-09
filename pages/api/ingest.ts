// pages/api/ingest.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export const config = { api: { bodyParser: false } };

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB/file

async function parseForm(req: NextApiRequest) {
  // Use OS temp dir (writable on Vercel / serverless). Create a subfolder to avoid collisions.
  const safeTmp = path.join(os.tmpdir(), 'smartdocs_tmp_uploads');
  await fs.mkdir(safeTmp, { recursive: true });

  const form = formidable({
    multiples: true,
    uploadDir: safeTmp,
    keepExtensions: true,
    maxFileSize: MAX_FILE_BYTES,
  });

  return new Promise<{ filepaths: string[] }>((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err);
      const toArray = (f: any) => (Array.isArray(f) ? f : f ? [f] : []);
      const all = Object.values(files).flatMap(toArray);
      const filepaths = all.map((f: any) => f.filepath as string);
      resolve({ filepaths });
    });
  });
}

function resolvePdfParse(pdfModule: any): ((buf: Buffer) => Promise<any>) | null {
  if (!pdfModule) return null;
  if (typeof pdfModule === 'function') return pdfModule;
  if (pdfModule && typeof pdfModule.default === 'function') return pdfModule.default;
  if (pdfModule && typeof pdfModule.parse === 'function') return pdfModule.parse;
  return null;
}

/* Try several pdfjs import paths to support multiple versions/builds */
async function loadPdfJsLib(): Promise<{ lib: any; chosenPath: string } | null> {
  const candidates = [
    'pdfjs-dist/legacy/build/pdf',
    'pdfjs-dist/legacy/build/pdf.js',
    'pdfjs-dist/es5/build/pdf',
    'pdfjs-dist/build/pdf',
    'pdfjs-dist',
  ];

  for (const p of candidates) {
    try {
      // @ts-ignore runtime-only import
      const mod = await import(p);
      if (!mod) continue;
      const gd = mod.getDocument ?? (mod.default && mod.default.getDocument) ?? undefined;
      if (typeof gd === 'function') {
        const lib = mod.getDocument ? mod : (mod.default ? mod.default : mod);
        return { lib, chosenPath: p };
      }
    } catch (e) {
      // continue trying other candidates
      console.info(`pdfjs candidate "${p}" import failed:`, (e as any)?.message || e);
    }
  }
  return null;
}

async function extractTextWithPdfJs(buf: Buffer): Promise<string> {
  const found = await loadPdfJsLib();
  if (!found) throw new Error('Could not load a pdfjs-dist entry that exposes getDocument; check pdfjs-dist installation/version.');

  const { lib: pdfjsLib, chosenPath } = found;
  console.info('Using pdfjs lib from', chosenPath);

  const uint8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const loadingTask = pdfjsLib.getDocument({ data: uint8 });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages || 0;
  console.info(`pdfjs doc loaded: pages=${numPages}`);

  const pieces: string[] = [];
  for (let p = 1; p <= numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((it: any) => (it && it.str) ? it.str : '').join(' ');
      pieces.push(pageText);
      if (typeof (page as any).cleanup === 'function') {
        try { (page as any).cleanup(); } catch (_e) {}
      }
    } catch (pageErr) {
      console.warn(`Failed to extract text for page ${p}:`, (pageErr as any)?.message || pageErr);
    }
  }

  if (typeof (doc as any).destroy === 'function') {
    try { (doc as any).destroy(); } catch (_e) {}
  } else if (typeof (doc as any).cleanup === 'function') {
    try { (doc as any).cleanup(); } catch (_e) {}
  }

  return pieces.join('\n\n').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { filepaths } = await parseForm(req);
    if (!filepaths.length) return res.status(400).json({ error: 'No files' });

    const { chunkPage, embedTextsFromChunks } = await import('../../lib/rag');
    const { loadStore, saveStore } = await import('../../lib/store');

    if (typeof chunkPage !== 'function' || typeof embedTextsFromChunks !== 'function') {
      return res.status(500).json({ error: 'RAG helpers are not available or mis-exported' });
    }

    const allChunks: Array<{ text: string; source: string; page: number }> = [];

    // Try pdf-parse first (fast path)
    let pdfParseFn: ((buf: Buffer) => Promise<any>) | null = null;
    let pdfModuleShape: string[] = [];
    console.info('Attempting to load pdf-parse for PDF text extraction...');
    try {
      const pdfModule: any = await import('pdf-parse').catch(() => null);
      if (pdfModule) {
        pdfModuleShape = Object.keys(pdfModule);
        pdfParseFn = resolvePdfParse(pdfModule);
        console.info('pdf-parse module keys:', pdfModuleShape.slice(0, 40));
      }
    } catch (e) {
      console.warn('pdf-parse dynamic import threw:', (e as any)?.message || e);
    }

    const usePdfJsFallback = !pdfParseFn;
    if (usePdfJsFallback) {
      console.info('pdf-parse parse function not found. Will use pdfjs fallback. pdf-parse shape:', pdfModuleShape);
    } else {
      console.info('Using pdf-parse for extraction.');
    }

    for (const fp of filepaths) {
      const filename = path.basename(fp);
      try {
        const buf = await fs.readFile(fp);

        let fullText = '';
        if (pdfParseFn) {
          try {
            const result = await pdfParseFn(buf);
            fullText = (typeof result === 'string') ? result.trim() : (result?.text || '').toString().trim();
            console.info(`pdf-parse extracted ${fullText.length} chars for ${filename}`);
          } catch (pdfErr) {
            console.warn(`pdf-parse failed for ${filename}, falling back to pdfjs. Err:`, (pdfErr as any)?.message || pdfErr);
            try {
              fullText = await extractTextWithPdfJs(buf);
              console.info(`pdfjs fallback extracted ${fullText.length} chars for ${filename}`);
            } catch (pjErr: any) {
              console.error(`pdfjs fallback also failed for ${filename}:`, pjErr?.message || pjErr);
              throw pjErr;
            }
          }
        } else {
          // direct pdfjs path
          try {
            fullText = await extractTextWithPdfJs(buf);
            console.info(`pdfjs extracted ${fullText.length} chars for ${filename}`);
          } catch (pjErr: any) {
            console.error(`pdfjs extraction failed for ${filename}:`, pjErr?.message || pjErr);
            throw pjErr;
          }
        }

        if (!fullText) {
          console.warn(`No text extracted from file: ${filename}`);
          continue;
        }

        const pseudoPages = fullText.split(/\n\s*\n/g).filter(Boolean);
        if (pseudoPages.length === 0) {
          const chunks = chunkPage(fullText, filename, 1, 800, 200);
          allChunks.push(...chunks);
        } else {
          const MAX_PSEUDO_PAGES = 120;
          for (let i = 0; i < Math.min(pseudoPages.length, MAX_PSEUDO_PAGES); i++) {
            const pageText = pseudoPages[i];
            const chunks = chunkPage(pageText, filename, i + 1, 800, 200);
            allChunks.push(...chunks);
          }
        }
      } catch (fileErr: any) {
        console.error(`Error processing file ${filename}:`, fileErr?.message || fileErr);
      } finally {
        // Attempt to remove temp file. It's okay if this fails.
        await fs.unlink(fp).catch((err) => {
          console.warn('Failed to remove temp upload file:', fp, (err as any)?.message || err);
        });
      }
    }

    if (!allChunks.length) return res.status(400).json({ error: 'No readable text extracted' });

    const embeddings = await embedTextsFromChunks(allChunks);

    const store = await loadStore();
    if (!store || !Array.isArray(store.chunks) || !Array.isArray(store.embeddings)) {
      throw new Error('Store shape invalid: expected { chunks: [], embeddings: [] }');
    }

    store.chunks.push(...allChunks);
    store.embeddings.push(...embeddings);
    await saveStore(store);

    res.json({ ok: true, added: allChunks.length });
  } catch (e: any) {
    console.error('Ingest error:', e);
    res.status(500).json({ error: e?.message ? String(e.message).slice(0, 200) : 'Ingest failed' });
  }
}
