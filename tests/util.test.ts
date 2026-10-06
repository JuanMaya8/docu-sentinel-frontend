import test from 'node:test';
import assert from 'node:assert/strict';
import { numberShape, parseNumber, leadingDigit } from '../src/engine/util/numbers';
import { parseDate, epochDaysToIso } from '../src/engine/util/dates';
import { hash53, mix32 } from '../src/engine/util/hash';
import { fmtNum, fmtPercent } from '../src/engine/i18n/es';
import { nameTokens, normalizeLabel, isNullToken } from '../src/engine/util/text';
import { QuantileSketch } from '../src/engine/sketch/ddsketch';
import { KmvSketch } from '../src/engine/sketch/kmv';

test('numberShape detects decimal style', () => {
  assert.equal(numberShape('1.234,56')?.hint, 'comma');
  assert.equal(numberShape('1,234.56')?.hint, 'dot');
  assert.equal(numberShape('12.5')?.hint, 'dot');
  assert.equal(numberShape('12,5')?.hint, 'comma');
  assert.equal(numberShape('1.234')?.hint, 'ambiguous');
  assert.equal(numberShape('1.234.567')?.hint, 'comma');
  assert.equal(numberShape('42')?.hint, 'neutral');
  assert.equal(numberShape('abc'), null);
  assert.equal(numberShape('12-05'), null);
});

test('parseNumber honours the column style, currency and parentheses', () => {
  assert.equal(parseNumber('1.234,56', 'comma'), 1234.56);
  assert.equal(parseNumber('1,234.56', 'dot'), 1234.56);
  assert.equal(parseNumber('$ 1,200', 'dot'), 1200);
  assert.equal(parseNumber('(1.200,50)', 'comma'), -1200.5);
  assert.equal(parseNumber('-7', 'dot'), -7);
  assert.ok(Number.isNaN(parseNumber('abc', 'dot')));
});

test('leadingDigit is exact', () => {
  assert.equal(leadingDigit(1000), 1);
  assert.equal(leadingDigit(999.9), 9);
  assert.equal(leadingDigit(0.0042), 4);
  assert.equal(leadingDigit(-52), 5);
});

test('dates: valid, impossible and mixed order', () => {
  assert.equal(epochDaysToIso(parseDate('05/03/2025')!.days), '2025-03-05'); // dmy
  assert.equal(epochDaysToIso(parseDate('2025-03-05')!.days), '2025-03-05');
  assert.equal(parseDate('31/02/2025')!.impossible, true);
  assert.ok(Number.isNaN(parseDate('31/02/2025')!.days));
  const mixed = parseDate('12/25/2025')!; // only valid as mdy
  assert.equal(mixed.format, 'mdy');
  assert.equal(epochDaysToIso(mixed.days), '2025-12-25');
  assert.equal(parseDate('29/02/2024')!.impossible, false); // leap year
  assert.equal(parseDate('29/02/2023')!.impossible, true);
  assert.equal(parseDate('hola'), null);
  assert.equal(parseDate('12345'), null);
});

test('hash53 is stable and well distributed', () => {
  assert.equal(hash53('abc'), hash53('abc'));
  assert.notEqual(hash53('abc'), hash53('abd'));
  assert.ok(hash53('x') < 2 ** 53);
  assert.ok(mix32(1) !== mix32(2));
});

test('es-CO formatting', () => {
  assert.equal(fmtNum(1234.5), '1.234,5');
  assert.equal(fmtNum(1200), '1.200');
  assert.equal(fmtNum(-7.25), '-7,25');
  assert.equal(fmtNum(0.5), '0,5');
  assert.equal(fmtNum(1234567), '1.234.567');
  assert.equal(fmtPercent(0.5), '50%');
  assert.equal(fmtPercent(0.035), '3,5%');
});

test('text helpers', () => {
  assert.deepEqual(nameTokens('unitPrice'), ['unit', 'price']);
  assert.deepEqual(nameTokens('Precio_Unitario'), ['precio', 'unitario']);
  assert.equal(normalizeLabel('  BogOtá '), 'bogota');
  assert.ok(isNullToken('N/A'));
  assert.ok(isNullToken('  '));
  assert.ok(!isNullToken('0'));
});

test('QuantileSketch: accurate and partition-invariant', () => {
  const values = Array.from({ length: 20000 }, (_, i) => Math.exp(((i * 7919) % 10007) / 1000));
  const whole = new QuantileSketch();
  values.forEach((v) => whole.add(v));
  const sorted = [...values].sort((a, b) => a - b);
  for (const q of [0.01, 0.25, 0.5, 0.75, 0.99]) {
    const exact = sorted[Math.floor(q * (sorted.length - 1))];
    const est = whole.quantile(q);
    assert.ok(Math.abs(est - exact) / exact < 0.03, `q=${q} est=${est} exact=${exact}`);
  }
  // any partition gives the identical sketch
  for (const parts of [2, 3, 7]) {
    const merged = new QuantileSketch();
    for (let p = 0; p < parts; p++) {
      const s = new QuantileSketch();
      values.forEach((v, i) => {
        if (i % parts === p) s.add(v);
      });
      merged.merge(QuantileSketch.from(s.serialize()));
    }
    assert.deepEqual(merged.serialize(), whole.serialize());
  }
});

test('QuantileSketch handles negatives and zero', () => {
  const s = new QuantileSketch();
  [-100, -10, -1, 0, 0, 1, 10, 100].forEach((v) => s.add(v));
  assert.ok(s.quantile(0) === -100 && s.quantile(1) === 100);
  assert.equal(s.quantile(0.5), 0);
});

test('KmvSketch: exact when small, close when large, partition-invariant', () => {
  const a = new KmvSketch(256);
  for (let i = 0; i < 100; i++) a.add(mix32(i));
  assert.equal(a.estimate(), 100);
  assert.ok(a.exact);
  const big = new KmvSketch(1024);
  for (let i = 0; i < 100000; i++) big.add(mix32(i));
  const est = big.estimate();
  assert.ok(Math.abs(est - 100000) / 100000 < 0.1, `estimate ${est}`);
  const halves = [new KmvSketch(1024), new KmvSketch(1024)];
  for (let i = 0; i < 100000; i++) halves[i % 2].add(mix32(i));
  halves[0].merge(halves[1]);
  assert.deepEqual(halves[0].serialize(), big.serialize());
});
