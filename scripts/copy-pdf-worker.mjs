// Copies the pdf.js worker next to the static files so pdf.js can load it at runtime (/pdf.worker.min.mjs).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
  join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
];
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.warn('[copy-pdf-worker] pdfjs-dist not installed yet: run `npm install` first. PDF analysis will not work until then.');
  process.exit(0);
}
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(src, join(root, 'public/pdf.worker.min.mjs'));
console.log('[copy-pdf-worker] copied', src.replace(root, '.'), '-> public/pdf.worker.min.mjs');
