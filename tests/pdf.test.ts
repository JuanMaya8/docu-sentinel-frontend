import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { detectTable, extractPdfTable, groupLines, lineToCells, linesToTabular, type PdfJsLike, type TextItem } from '../src/engine/parsers/pdf';
import { analyzeFile, InlinePool } from '../src/engine';

const item = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5 });

test('pdf layout: items on the same baseline become one line; wide gaps split cells', () => {
  const lines = groupLines([item('FV-1001', 40, 700), item('Andes', 130, 700.5), item('Logistica', 160, 700.5), item('12', 300, 700), item('FV-1002', 40, 684)]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lineToCells(lines[0]), ['FV-1001', 'Andes Logistica', '12']);
});

test('pdf layout: longest run of same-width lines is the table; first line is the header', () => {
  const t = detectTable([['Factura:', '1'], ['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['pie de página']]);
  assert.ok(t);
  assert.deepEqual(t!.header, ['a', 'b', 'c']);
  assert.equal(t!.rows.length, 3);
});

test('pdf layout: tables on several pages are concatenated, repeated headers are dropped', () => {
  const page = [['id', 'name', 'qty'], ['1', 'x', '1'], ['2', 'y', '2'], ['3', 'z', '3']];
  const tab = linesToTabular([page, page]);
  assert.equal(tab.rows.length, 6);
});

test('pdf layout: no table and no labels -> clear error', () => {
  assert.throws(() => linesToTabular([[['hola mundo']]]), /No se pudo extraer/);
});

test('pdf layout: "Label: value" documents become a single record', () => {
  const tab = linesToTabular([[['Cliente: ACME'], ['Total: 1200'], ['Fecha: 01/02/2025']]]);
  assert.equal(tab.rows.length, 1);
  assert.deepEqual(tab.rows[0], ['ACME', '1200', '01/02/2025']);
});

// Real PDF through pdf.js (Node). Skipped when pdfjs-dist is not installed.
test('real PDF fixture: pdf.js extracts the table and the engine finds the injected anomalies', async (t) => {
  const path = new URL('./fixtures/facturas.pdf', import.meta.url);
  if (!existsSync(path)) return t.skip('fixture missing: run python scripts/make-pdf-fixture.py');
  let pdfjs: PdfJsLike;
  try {
    pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => import('pdfjs-dist'))) as unknown as PdfJsLike;
  } catch {
    return t.skip('pdfjs-dist not installed');
  }
  const buf = readFileSync(path);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const tab = await extractPdfTable(data, pdfjs);
  assert.equal(tab.header.length, 6);
  assert.equal(tab.rows.length, 80);

  const pool = new InlinePool(1, { loadPdfJs: async () => pdfjs });
  const session = await analyzeFile(pool, new Blob([buf]), 'facturas.pdf', { now: Date.UTC(2026, 0, 15), ml: { mode: 'off', seed: 1 } }, 'main');
  const found = new Set(session.report.findings.map((f) => `${f.recordIndex}:${f.type}`));
  for (const key of ['10:impossible_relation', '25:type_mismatch', '40:impossible_date', '55:duplicate_exact']) {
    assert.ok(found.has(key), `expected ${key}; got ${[...found].slice(0, 12).join(', ')}`);
  }
  assert.equal(session.report.meta.format, 'pdf');
  session.dispose();
});
