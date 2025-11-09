// pages/api/ingest.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import path from 'node:path';
import fs from 'node:fs/promises';

export const config = { api: { bodyParser: false } };

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB/file

async function parseForm(req: NextApiRequest) {
  const uploadDir = path.join(process.cwd(), 'tmp_uploads');
  await fs.mkdir(uploadDir, { recursive: true });

  const form = formidable({
    multiples: true,
    uploadDir,
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

/**
 * Attempt to import a working pdfjs-dist entry that exposes getDocument.
 * Returns { lib, chosenPath } or throws.
 */
async function loadPdfJsLib(): Promise<{ lib: any; chosenPath: string }> {
  const candidates = [
    'pdfjs-dist/legacy/build/pdf',
    'pdfjs-dist/legacy/build/pdf.js',
    'pdfjs-dist/es5/build/pdf',
    'pdfjs-dist/build/pdf',
  ];

  for (const p of candidates) {
    try {
      // @ts-ignore dynamic import - runtime-only
      const mod = await import(p);
      if (!mod) {
        console.warn(`pdfjs import ${p} returned falsy module`);
        continue;
      }
      const keys = Object.keys(mod);
      const gd = mod.getDocument ?? (mod.default && mod.default.getDocument) ?? undefined;
      console.info(`Tried pdfjs path "${p}" — module keys:`, keys.slice(0, 40));
      if (typeof gd === 'function') {
        // normalize lib to an object that has getDocument reference
        const lib = mod.getDocument ? mod : (mod.default ? mod.default : mod);
        return { lib, chosenPath: p };
      } else {
        console.warn(`pdfjs path "${p}" does not expose getDocument (typeof: ${typeof gd})`);
      }
    } catch (e: any) {
      console.warn(`Import candidate "${p}" threw:`, (e && e.message) || e);
    }
  }

  throw new Error('Could not load a pdfjs-dist entry that exposes getDocument; check pdfjs-dist installation/version.');
}

/**
 * Extract text via pdfjs-dist (tries multiple entrypoints internally using loadPdfJsLib()).
 */
async function extractTextWithPdfJs(buf: Buffer): Promise<string> {
  const { lib: pdfjsLib, chosenPath } = await loadPdfJsLib();
  console.info('Using pdfjs lib from', chosenPath);

  // Ensure we pass a plain Uint8Array
  const uint8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  // Use getDocument
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
    } catch (pageErr: any) {
      console.warn(`Failed to extract text for page ${p}:`, pageErr?.message || pageErr);
    }
  }

  // try to destroy/cleanup doc
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

    // Try pdf-parse first
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
        await fs.unlink(fp).catch(() => {});
      }
    }

    if (!allChunks.length) return res.status(400).json({ error: 'No readable text extracted' });
    console.log(allChunks);

    const embeddings = await embedTextsFromChunks(allChunks);

    const store = await loadStore();
    if (!store || !Array.isArray(store.chunks) || !Array.isArray(store.embeddings)) {
      throw new Error('Store shape invalid: expected { chunks: [], embeddings: [] }');
    }
    console.log(allChunks, embeddings);
    store.chunks.push(...allChunks);
    store.embeddings.push(...embeddings);
    await saveStore(store);

    res.json({ ok: true, added: allChunks.length });
  } catch (e: any) {
    console.error('Ingest error:', e);
    // return the message but avoid leaking huge internals
    res.status(500).json({ error: e?.message ? String(e.message).slice(0, 200) : 'Ingest failed' });
  }
}
