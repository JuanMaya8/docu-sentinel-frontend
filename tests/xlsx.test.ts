import test from 'node:test';
import assert from 'node:assert/strict';
import { columnIndex, decodeXml, isDateFormat, parseXlsx, serialToIso, XlsxError } from '../src/engine/parsers/xlsx';
import { analyzeFile } from '../src/engine/pipeline/coordinator';
import { InlinePool } from '../src/engine/pipeline/pool';
import { detectFormat } from '../src/engine/pipeline/ingest';
// @ts-expect-error plain .mjs helper without type declarations
import { buildXlsx, invoiceRows } from '../scripts/xlsx-writer.mjs';

const NOW = Date.UTC(2026, 9, 6);

test('xlsx helpers: column letters, XML entities, date formats and serials', () => {
  assert.deepEqual(['A1', 'Z9', 'AA10', 'AZ1', 'XFD1'].map(columnIndex), [0, 25, 26, 51, 16383]);
  assert.equal(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &#233; &#x00F1;'), 'a & b <c> "d" é ñ');
  assert.equal(isDateFormat('dd/mm/yyyy'), true);
  assert.equal(isDateFormat('[$-409]mmm d, yyyy'), true);
  assert.equal(isDateFormat('#,##0.00'), false);
  assert.equal(isDateFormat('"días" 0'), false, 'quoted text is ignored');
  assert.equal(serialToIso(45658, false), '2025-01-01');
  assert.equal(serialToIso(45658.5, false), '2025-01-01T12:00:00');
  assert.equal(serialToIso(44196, true), '2025-01-01', '1904 date system');
});

test('xlsx: shared strings, inline strings, numbers, booleans, formulas, dates and gaps', async () => {
  for (const sharedStrings of [true, false]) {
    for (const compress of [true, false]) {
      const buf = buildXlsx({
        sharedStrings,
        compress,
        sheets: [{
          name: 'Ventas',
          rows: [
            ['Código', 'Fecha', 'Monto', 'Activo', 'Nota', 'Calc'],
            ['A&B <1>', new Date(Date.UTC(2025, 0, 15)), 1234.5, true, '', { formula: 'C2*2', cached: '2469' }],
            [],
            ['X2', new Date(Date.UTC(2025, 1, 2, 6, 30)), -7, false, 'ñandú', null],
          ],
        }, { name: 'Otra', rows: [['ignorada']] }],
      });
      const t = await parseXlsx(buf);
      assert.equal(t.sheetName, 'Ventas');
      assert.deepEqual(t.header, ['Código', 'Fecha', 'Monto', 'Activo', 'Nota', 'Calc']);
      assert.deepEqual(t.rows, [
        ['A&B <1>', '2025-01-15', '1234.5', 'true', '', '2469'],
        ['X2', '2025-02-02T06:30:00', '-7', 'false', 'ñandú', ''],
      ]);
      assert.ok(t.warnings.some((w) => /2 hojas/.test(w)));
      assert.ok(t.warnings.some((w) => /1 filas completamente vacías/.test(w)));
    }
  }
});

test('xlsx: clear Spanish errors for non-xlsx, empty and header-only sheets', async () => {
  await assert.rejects(() => parseXlsx(new TextEncoder().encode('a,b\n1,2')), (e: unknown) => e instanceof XlsxError && /no es un \.xlsx válido/.test((e as Error).message));
  await assert.rejects(() => parseXlsx(buildXlsx({ sheets: [{ name: 'Vacía', rows: [] }] })), /está vacía/);
  await assert.rejects(() => parseXlsx(buildXlsx({ sheets: [{ name: 'H', rows: [['a', 'b']] }] })), /solo tiene encabezado/);
  assert.throws(() => detectFormat('viejo.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), /\.xls/);
  assert.equal(detectFormat('libro.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'xlsx');
  assert.equal(detectFormat('sin-extension', new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'xlsx');
});

test('xlsx end-to-end: the engine finds the seeded anomalies (same pipeline as CSV)', async () => {
  const buf = buildXlsx({ sheets: [{ name: 'Facturas', rows: invoiceRows(300) }] });
  const blob = new Blob([buf]);
  for (const workers of [1, 3]) {
    const session = await analyzeFile(new InlinePool(workers), blob, 'facturas.xlsx', { now: NOW }, 'pool');
    const r = session.report;
    assert.equal(r.meta.format, 'xlsx');
    assert.equal(r.meta.rows, 300);
    assert.equal(r.meta.keyColumn, 'Factura');
    const at = (row: number) => r.findings.filter((f) => f.recordIndex === row).map((f) => f.type);
    assert.ok(at(10).some((t) => t === 'out_of_range' || t === 'impossible_relation' || t === 'multivariate_anomaly'), `row 10: ${at(10)}`);
    assert.ok(at(20).includes('negative_value'), `row 20: ${at(20)}`);
    assert.ok(at(30).includes('duplicate_exact') || at(30).includes('duplicate_key'), `row 30: ${at(30)}`);
    const rec = await session.getRecord(10);
    assert.equal(rec.values[0], 'FV-1010');
  }
});
