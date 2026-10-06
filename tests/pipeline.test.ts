import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFile } from '../src/engine/pipeline/coordinator';
import { InlinePool } from '../src/engine/pipeline/pool';
import { generateDataset, type TruthItem } from '../src/engine/synth';
import { findingsToCsv, findingsToJson } from '../src/engine/exporters';
import type { AnomalyType, Finding, Report } from '../src/engine/types';

const NOW = Date.UTC(2026, 9, 6); // fixed clock so "future date" checks are deterministic

async function run(blob: Blob, name: string, workers: number, extra = {}): Promise<{ report: Report; session: Awaited<ReturnType<typeof analyzeFile>> }> {
  const pool = new InlinePool(workers);
  const session = await analyzeFile(pool, blob, name, { now: NOW, ...extra }, 'pool');
  return { report: session.report, session };
}

function recall(findings: Finding[], truth: TruthItem[], type: AnomalyType, accept: AnomalyType[] = [type]): { hit: number; total: number } {
  const rows = truth.filter((t) => t.type === type);
  let hit = 0;
  for (const t of rows) {
    if (findings.some((f) => f.recordIndex === t.row && accept.includes(f.type))) hit++;
  }
  return { hit, total: rows.length };
}

test('invoices: every injected anomaly kind is detected (recall by type)', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 30000, seed: 7 });
  const { report } = await run(data.blob, data.fileName, 3);
  assert.equal(report.meta.rows, 30000);
  assert.equal(report.meta.format, 'csv');
  assert.equal(report.meta.keyColumn, 'invoice_number');
  const expectations: Array<[AnomalyType, AnomalyType[], number]> = [
    ['duplicate_exact', ['duplicate_exact'], 0.95],
    ['duplicate_key', ['duplicate_key'], 0.95],
    ['duplicate_near', ['duplicate_near'], 0.9],
    ['missing_field', ['missing_field'], 0.95],
    ['type_mismatch', ['type_mismatch'], 0.95],
    ['impossible_date', ['impossible_date'], 0.95],
    ['out_of_range', ['out_of_range'], 0.9],
    ['negative_value', ['negative_value'], 0.95],
    ['impossible_relation', ['impossible_relation'], 0.9],
    ['inconsistent_label', ['inconsistent_label'], 0.9],
    ['whitespace', ['whitespace'], 0.9],
    ['suspicious_threshold', ['suspicious_threshold'], 0.8],
  ];
  const lines: string[] = [];
  for (const [type, accept, min] of expectations) {
    const r = recall(report.findings, data.truth, type, accept);
    lines.push(`${type}: ${r.hit}/${r.total}`);
    assert.ok(r.total > 0, `no injected ${type}`);
    assert.ok(r.hit / r.total >= min, `recall ${type} ${r.hit}/${r.total} < ${min}\n${lines.join('\n')}`);
  }
  console.log('recall:', lines.join(' | '));
});

test('invoices: precision — few findings on rows that were NOT injected', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 30000, seed: 7 });
  const { report } = await run(data.blob, data.fileName, 2);
  const injected = new Set(data.truth.map((t) => t.row));
  const rowFindings = report.findings.filter((f) => f.recordIndex !== null);
  const falsePositives = rowFindings.filter((f) => !injected.has(f.recordIndex!));
  // collateral findings on injected rows are fine; unrelated rows should be rare
  const fpRows = new Set(falsePositives.map((f) => f.recordIndex));
  console.log(`rows with findings outside injected rows: ${fpRows.size} (${((fpRows.size / 30000) * 100).toFixed(3)}%); by type:`, JSON.stringify(countBy(falsePositives)));
  // 1) deterministic rules: must be almost silent on rows that were not injected.
  //    (suspicious_threshold is excluded: every natural row inside a bunching window is flagged on purpose.)
  const ruleRows = new Set(falsePositives.filter((f) => f.type !== 'multivariate_anomaly' && f.type !== 'suspicious_threshold').map((f) => f.recordIndex));
  assert.ok(ruleRows.size / 30000 < 0.002, `rule false-positive row rate ${ruleRows.size / 30000}`);
  // 2) ML: bounded by its contamination budget (medium = 1%) plus a small margin
  const mlRows = new Set(falsePositives.filter((f) => f.type === 'multivariate_anomaly').map((f) => f.recordIndex));
  assert.ok(mlRows.size / 30000 < 0.012, `ML flagged-row rate on non-injected rows ${mlRows.size / 30000}`);
});

function countBy(fs: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fs) out[f.type] = (out[f.type] ?? 0) + 1;
  return out;
}

test('DETERMINISM: identical findings for pool sizes 1, 2, 3 and 4', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 40000, seed: 3 });
  let reference: string | null = null;
  for (const n of [1, 2, 3, 4]) {
    const { report } = await run(data.blob, data.fileName, n);
    const key = JSON.stringify({ findings: report.findings, byRisk: report.byRisk, byType: report.byType, rows: report.meta.rows, cols: report.columns });
    if (reference === null) reference = key;
    else assert.equal(key, reference, `pool size ${n} differs from pool size 1`);
  }
});

test('main-thread (blocking) mode gives the same result as the pool', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 20000, seed: 9 });
  const pool = new InlinePool(1);
  const main = await analyzeFile(pool, data.blob, data.fileName, { now: NOW }, 'main');
  const { report: multi } = await run(data.blob, data.fileName, 3);
  assert.deepEqual(main.report.findings, multi.findings);
  assert.equal(main.report.meta.mode, 'main');
});

test('inventory JSON (nested objects, nulls): relations, negatives, ranges, key duplicates', async () => {
  const data = generateDataset({ kind: 'inventory', rows: 8000, seed: 5, anomalyRate: 0.02 });
  const { report } = await run(data.blob, data.fileName, 2);
  assert.equal(report.meta.format, 'json');
  assert.ok(report.columns.some((c) => c.name === 'warehouse.code'), 'nested keys are flattened with dot notation');
  const checks: Array<[AnomalyType, number]> = [
    ['impossible_relation', 0.9],
    ['negative_value', 0.9],
    ['out_of_range', 0.9],
    ['missing_field', 0.9],
    ['duplicate_key', 0.9],
    ['type_mismatch', 0.9],
  ];
  for (const [type, min] of checks) {
    const r = recall(report.findings, data.truth, type);
    assert.ok(r.total > 0 && r.hit / r.total >= min, `${type} ${r.hit}/${r.total}`);
  }
});

test('ML: Isolation Forest finds combos that no univariate rule sees', async () => {
  const data = generateDataset({ kind: 'orders', rows: 20000, seed: 21, anomalyRate: 0.01 });
  const { report } = await run(data.blob, data.fileName, 3);
  const ml = report.findings.filter((f) => f.type === 'multivariate_anomaly');
  const truth = new Set(data.truth.map((t) => t.row));
  const hits = ml.filter((f) => truth.has(f.recordIndex!)).length;
  const r = hits / data.truth.length;
  const precision = ml.length ? hits / ml.length : 0;
  console.log(`ML recall ${hits}/${data.truth.length} (${(r * 100).toFixed(1)}%), flagged ${ml.length}, precision ${(precision * 100).toFixed(1)}%`);
  assert.ok(r >= 0.6, `ML recall ${r}`);
  assert.ok(precision >= 0.4, `ML precision ${precision}`);
  assert.ok(ml.every((f) => /desviaciones robustas|poco frecuente|vacío|no es coherente/.test(f.explanation)), 'ML findings are explained in Spanish');
  assert.ok(report.meta.mlMode === 'local');
});

test('ML can be disabled and sensitivity changes how many range findings appear', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 15000, seed: 2 });
  const off = await run(data.blob, data.fileName, 2, { ml: { mode: 'off', seed: 42 } });
  assert.equal(off.report.findings.filter((f) => f.type === 'multivariate_anomaly').length, 0);
  const high = await run(data.blob, data.fileName, 2, { sensitivity: 'high' });
  const low = await run(data.blob, data.fileName, 2, { sensitivity: 'low' });
  const count = (r: Report) => r.findings.filter((f) => f.type === 'out_of_range').length;
  assert.ok(count(high.report) >= count(low.report), 'higher sensitivity never finds fewer range anomalies');
});

test('clean data produces (almost) no findings', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 20000, seed: 13, anomalyRate: 0 });
  const { report } = await run(data.blob, data.fileName, 2);
  const high = report.findings.filter((f) => f.risk === 'high' || f.risk === 'critical');
  console.log('clean data findings:', report.findings.length, 'high+critical:', high.length, JSON.stringify(countBy(report.findings)));
  assert.ok(high.length <= 5, `${high.length} high/critical findings on clean data`);
});

test('report: record lookup, exports and metadata', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 5000, seed: 4 });
  const { report, session } = await run(data.blob, data.fileName, 3);
  const first = report.findings.find((f) => f.recordIndex !== null)!;
  const rec = await session.getRecord(first.recordIndex!);
  assert.equal(rec.header.length, 13);
  assert.equal(rec.values.length, 13);
  const csv = findingsToCsv(report.findings.slice(0, 20));
  assert.ok(csv.startsWith('﻿Registro,Tipo de anomalía,Nivel de riesgo,Campo afectado,Explicación'));
  assert.ok(JSON.parse(findingsToJson(report.findings.slice(0, 3))).length === 3);
  assert.ok(report.meta.phaseMs.parse >= 0 && report.meta.durationMs > 0);
  assert.ok(report.topRecords.length > 0 && report.topRecords[0].score >= report.topRecords[report.topRecords.length - 1].score);
  assert.equal(report.totalFindings, report.findings.length);
});

test('NDJSON and TSV and semicolon CSV with comma decimals', async () => {
  const nd = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ id: `A${i}`, qty: (i % 20) + 1, price: 1000 + (i % 50) * 10, owner: { name: `n${i % 30}` } })).join('\n');
  const r1 = await run(new Blob([nd]), 'datos.ndjson', 2);
  assert.equal(r1.report.meta.format, 'ndjson');
  assert.equal(r1.report.meta.rows, 3000);
  assert.ok(r1.report.columns.some((c) => c.name === 'owner.name'));

  const tsv = 'id\tvalor\n' + Array.from({ length: 500 }, (_, i) => `${i}\t${i * 3}`).join('\n');
  const r2 = await run(new Blob([tsv]), 'x.tsv', 1);
  assert.equal(r2.report.meta.format, 'tsv');
  assert.equal(r2.report.meta.rows, 500);

  const semi = 'codigo;monto\n' + Array.from({ length: 800 }, (_, i) => `C${i};${(1000 + i * 7).toLocaleString('de-DE')},50`).join('\n') + '\nC9999;999999999,00\n';
  const r3 = await run(new Blob([semi]), 'ventas.csv', 2);
  const monto = r3.report.columns.find((c) => c.name === 'monto')!;
  assert.equal(monto.type, 'decimal');
  assert.ok(r3.report.findings.some((f) => f.field === 'monto' && f.type === 'out_of_range'), 'comma-decimal amounts parsed and extreme value flagged');
});

test('windows-1252 encoded CSV is decoded correctly', async () => {
  const header = 'ciudad,valor\n';
  const body = Array.from({ length: 200 }, (_, i) => `Bogotá,${i}`).join('\n');
  // encode as latin1: á = 0xE1
  const bytes = new Uint8Array([...header, ...body].map((c) => (c === 'á' ? 0xe1 : (c as string).charCodeAt(0))));
  const { session } = await run(new Blob([bytes]), 'latin1.csv', 1);
  const rec = await session.getRecord(0);
  assert.equal(rec.values[0], 'Bogotá');
});

test('empty and header-only files fail with a clear message', async () => {
  await assert.rejects(() => run(new Blob(['']), 'vacio.csv', 1), /vacío/);
  await assert.rejects(() => run(new Blob(['a,b,c\n']), 'solo_encabezado.csv', 1), /no contiene registros/);
});

test('progress is reported and abort works', async () => {
  const data = generateDataset({ kind: 'invoices', rows: 5000, seed: 1 });
  const seen = new Set<string>();
  const pool = new InlinePool(2);
  await analyzeFile(pool, data.blob, 'x.csv', { now: NOW }, 'pool', { onProgress: (p) => seen.add(p.phase) });
  for (const phase of ['plan', 'parse', 'stats', 'features', 'detect', 'resolve', 'done']) assert.ok(seen.has(phase), `missing phase ${phase}`);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => analyzeFile(new InlinePool(1), data.blob, 'x.csv', { now: NOW }, 'pool', { signal: ac.signal }), /cancelado/);
});
