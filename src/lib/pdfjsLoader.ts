/**
 * Loads pdf.js lazily (only when a PDF is analysed) and points it at the worker file that
 * `scripts/copy-pdf-worker.mjs` copies to /public/pdf.worker.min.mjs.
 */
import type { PdfJsLike } from '../engine/parsers/pdf';

let cached: Promise<PdfJsLike> | null = null;

export function loadPdfJsInWorker(): Promise<PdfJsLike> {
  if (!cached) {
    cached = (async () => {
      const mod = (await import('pdfjs-dist')) as unknown as PdfJsLike & { GlobalWorkerOptions: { workerSrc: string } };
      const base = (self as unknown as { location: { origin: string } }).location.origin;
      mod.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;
      return mod;
    })();
  }
  return cached;
}
