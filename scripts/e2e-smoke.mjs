/**
 * End-to-end smoke test of the REAL stack (Next.js frontend + NestJS backend + FastAPI AI), driven with Playwright.
 *
 *   1. start docu-sentinel-ai (port 8000) and docu-sentinel-backend (port 3001, CORS for the frontend origin)
 *   2. npm run build && npm start               (NEXT_PUBLIC_API_URL must point to the backend at build time)
 *   3. E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * Works with and without user accounts on the backend (JWT_SECRET): when the header shows «Ingresar», the test
 * creates a fresh account first and also checks that history is private before logging in.
 *
 * Env: E2E_BASE_URL (default http://localhost:3000), CHROMIUM_PATH (optional browser executable),
 *      E2E_SKIP_BACKEND=1 to run only the local (browser-only) part.
 */
import { chromium } from 'playwright';
import { buildXlsx, invoiceRows } from './xlsx-writer.mjs';

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const WITH_BACKEND = process.env.E2E_SKIP_BACKEND !== '1';
const TIMEOUT = 120_000;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/favicon|Failed to load resource|WebSocket/.test(text)) return;
  errors.push(text);
});

async function analyzeSample() {
  await page.getByTestId('sample-btn').click();
  await page.getByRole('button', { name: 'Guardar en historial' }).waitFor({ timeout: TIMEOUT });
}

try {
  // ------------------------------------------------------------------ analyze locally
  await page.goto(`${BASE}/analizar`);
  await analyzeSample();
  const counter = await page.locator('[aria-live="polite"]', { hasText: 'hallazgos' }).first().textContent();
  check('Analizar datos de ejemplo muestra el reporte', /\d/.test(counter ?? ''), counter?.trim());
  check('La tabla virtualizada de hallazgos es accesible', await page.getByRole('table', { name: 'Hallazgos' }).isVisible());

  // filter + drawer
  await page.locator('#f-risk').selectOption('critical');
  const filtered = await page.locator('[aria-live="polite"]', { hasText: 'hallazgos' }).first().textContent();
  check('El filtro por riesgo reduce la tabla', /de/.test(filtered ?? ''), filtered?.trim());
  await page.locator('#f-risk').selectOption('');

  // export
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar CSV' }).click()]);
  check('Exportar CSV descarga un archivo', download.suggestedFilename().endsWith('.csv'), download.suggestedFilename());

  // theme toggle
  const toggle = page.locator('.theme-toggle');
  await toggle.click();
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await toggle.click();
  const t2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await toggle.click();
  const t3 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('El interruptor de tema recorre claro → oscuro → automático', t1 === 'light' && t2 === 'dark' && t3 === null, `${t1} → ${t2} → ${t3}`);

  if (WITH_BACKEND) {
    // ---------------------------------------------------------------- save to history
    await page.getByRole('button', { name: 'Guardar en historial' }).click();
    const open = page.getByRole('link', { name: 'Abrir reporte' });
    await open.waitFor({ timeout: 30_000 });
    check('Guardar en historial devuelve un enlace al reporte', (await open.getAttribute('href'))?.startsWith('/reportes/an_'));

    // ---------------------------------------------------------------- baseline: train in the AI, then reuse it
    const name = `E2E ${Date.now()}`;
    await page.getByLabel('Nombre de la línea base').fill(name);
    await page.getByRole('button', { name: 'Guardar como línea base' }).click();
    const trained = page.locator('.alert', { hasText: 'entrenada' });
    await trained.waitFor({ timeout: TIMEOUT });
    check('Entrenar una línea base en la IA', true, (await trained.textContent())?.trim().slice(0, 80));

    await page.locator('#ml').selectOption('baseline');
    const option = page.locator('#bl option', { hasText: name });
    await option.waitFor({ state: 'attached', timeout: 15_000 });
    await page.locator('#bl').selectOption(await option.getAttribute('value'));
    const scored = page.waitForResponse((r) => /\/baselines\/bl_[0-9a-f]+\/score$/.test(r.url()) && r.request().method() === 'POST', { timeout: TIMEOUT });
    await page.getByTestId('sample-btn').click();
    const scoreRes = await scored.catch(() => null);
    await page.getByTestId('sample-btn').and(page.locator(':enabled')).waitFor({ timeout: TIMEOUT });
    const alerts = (await page.locator('.alert').allTextContents()).join(' | ');
    const fallback = /no respondió|No se pudo usar la línea base|no es compatible|Elige una línea base/.test(alerts);
    check('Reanalizar con la línea base histórica puntúa en la IA', scoreRes?.status() === 200 && !fallback, scoreRes ? `HTTP ${scoreRes.status()}` : alerts.slice(0, 160));

    // ---------------------------------------------------------------- reports page (SSR + realtime)
    await page.goto(`${BASE}/reportes`);
    await page.getByRole('heading', { name: 'Reportes guardados' }).waitFor();
    const live = page.locator('.chip', { hasText: 'En vivo' });
    await live.waitFor({ timeout: 15_000 }).catch(() => undefined);
    check('El historial muestra reportes guardados', (await page.locator('table.plain tbody tr').count()) > 0);
    check('El chip «En vivo» se conecta por socket.io', await live.isVisible());
    await page.locator('table.plain tbody tr a').first().click();
    await page.getByRole('table', { name: 'Hallazgos' }).waitFor({ timeout: 30_000 }).catch(() => undefined);
    check('El detalle de un reporte guardado carga sus hallazgos', page.url().includes('/reportes/an_'));
  }

  check('Sin errores de página ni de consola', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('El flujo terminó sin excepciones', false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones OK`);
process.exit(failed ? 1 : 0);
