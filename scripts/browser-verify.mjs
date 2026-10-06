#!/usr/bin/env node
/**
 * Real-browser verification + benchmark (Chromium via Playwright).
 *   npm run verify:browser                      # quick: 50k and 200k rows
 *   SIZES=50000,200000,500000 REPS=2 npm run verify:browser
 * Env: CHROMIUM_PATH (use a system chromium), TOOLS_DIR (where esbuild/playwright live if not in node_modules), OUT (json path)
 * What it checks: (1) the worker bundle really runs in a Web Worker, (2) main / 1 worker / N workers give IDENTICAL findings,
 * (3) the PDF fixture is parsed with pdf.js in main thread and in workers, (4) aborting terminates workers,
 * (5) Main-vs-Workers timing and UI-freeze numbers.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = process.env.TOOLS_DIR;
const req = [createRequire(join(root, 'package.json')), ...(toolsDir ? [createRequire(join(toolsDir, 'package.json'))] : [])];
function dep(name) {
  for (const r of req) {
    try {
      return r(name);
    } catch {
      /* try next */
    }
  }
  throw new Error(`No se encontró «${name}». Ejecuta npm install (o define TOOLS_DIR).`);
}
const esbuild = dep('esbuild');
const { chromium } = dep('playwright');

const SIZES = (process.env.SIZES ?? '50000,200000').split(',').map(Number);
const REPS = Number(process.env.REPS ?? 1);
const POOL = Number(process.env.POOL ?? 2);
const outDir = join(root, '.verify-dist');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log('› Empaquetando harness y worker con esbuild…');
await esbuild.build({
  entryPoints: { harness: join(root, 'scripts/verify/harness-entry.ts'), worker: join(root, 'src/workers/shard.worker.ts') },
  outdir: outDir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['canvas', 'fs', 'path', 'zlib', 'http', 'https', 'url', 'node:*'],
});
const pdfWorker = ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', ...(toolsDir ? [join(toolsDir, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')] : [])].map((p) => resolve(root, p)).find(existsSync);
if (pdfWorker) copyFileSync(pdfWorker, join(outDir, 'pdf.worker.min.mjs'));
else console.warn('! pdf.worker.min.mjs no encontrado: la prueba de PDF puede fallar');

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.pdf': 'application/pdf', '.json': 'application/json' };
const server = createServer((reqq, res) => {
  const url = decodeURIComponent((reqq.url ?? '/').split('?')[0]);
  let file = url === '/' ? join(outDir, 'index.html') : url.startsWith('/fixtures/') ? join(root, 'tests', url) : join(outDir, url);
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>harness</title><script type="module" src="/harness.js"></script><body>harness</body>');
    return;
  }
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text() + (m.location()?.url ?? '')) && errors.push(m.text()));
await page.goto(base);
await page.waitForFunction(() => window.Harness, null, { timeout: 30000 });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
};
const run = (kind, rows, mode, workers, ml = true) => page.evaluate(([k, r, m, w, x]) => window.Harness.generated(k, r, m, w, x), [kind, rows, mode, workers, ml]);
const hw = await page.evaluate(() => window.Harness.hardware());
console.log(`› Chromium con ${hw.cores} núcleos lógicos`);

// ---- 1) identical results across modes + timing
const bench = [];
for (const rows of SIZES) {
  const perMode = {};
  for (const [mode, workers] of [['main', 1], ['worker', 1], ['pool', POOL]]) {
    const runs = [];
    for (let i = 0; i < REPS; i++) runs.push(await run('invoices', rows, mode, workers));
    runs.sort((a, b) => a.ms - b.ms);
    perMode[`${mode}`] = runs[Math.floor(runs.length / 2)];
    const r = perMode[mode];
    console.log(`  ${String(rows).padStart(8)} filas · ${mode.padEnd(6)} (${r.workers}) ${r.ms.toFixed(0).padStart(7)} ms · pausa máx ${r.frames.maxGapMs.toFixed(0)} ms · congelamientos ${r.frames.freezes} · ${r.frames.fps.toFixed(0)} fps · hallazgos ${r.totalFindings}`);
  }
  bench.push({ rows, bytes: perMode.main.bytes, ...perMode });
  const hashes = new Set(Object.values(perMode).map((r) => r.hash));
  check(`${rows} filas: main, 1 worker y ${POOL} workers dan hallazgos idénticos`, hashes.size === 1, [...hashes].join(' vs '));
  check(`${rows} filas: los modos worker usan Web Workers reales`, perMode.worker.workerKind === 'web-worker' && perMode.pool.workerKind === 'web-worker' && perMode.main.workerKind === 'inline');
}

// ---- 2) PDF through pdf.js, main thread and workers
for (const [mode, workers] of [['main', 1], ['pool', 2]]) {
  const r = await page.evaluate(([m, w]) => window.Harness.fixture('/fixtures/facturas.pdf', m, w), [mode, workers]);
  const set = new Set(r.keys);
  const missing = ['10:impossible_relation', '25:type_mismatch', '40:impossible_date', '55:duplicate_exact'].filter((k) => !set.has(k));
  check(`PDF (${mode}): 80 filas leídas con pdf.js y 4 anomalías sembradas encontradas`, r.format === 'pdf' && r.rows === 80 && missing.length === 0, missing.length ? 'faltan ' + missing.join(', ') : `${r.ms.toFixed(0)} ms`);
}

// ---- 3) abort
const ab = await page.evaluate(() => window.Harness.abortTest(400));
check('Cancelar detiene los workers (rechaza antes de terminar el archivo)', ab.aborted && ab.ms < 20000, `${ab.ms.toFixed(0)} ms`);

check('Sin errores de página ni de consola', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
rmSync(outDir, { recursive: true, force: true });

const result = { date: new Date().toISOString(), cores: hw.cores, userAgent: hw.ua, pool: POOL, reps: REPS, bench, checks };
const outPath = process.env.OUT ?? join(root, 'verify-results.json');
writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nResultados guardados en ${outPath}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
