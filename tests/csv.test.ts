import test from 'node:test';
import assert from 'node:assert/strict';
import { CsvParser, parseCsvText, sniffDelimiter, normalizeHeader } from '../src/engine/parsers/csv';
import { BoundaryScanner, rangesFrom, effectiveShardCount } from '../src/engine/pipeline/planner';
import { mulberry32 } from '../src/engine/util/prng';

test('basic rows, quotes, escaped quotes, embedded newlines and delimiters', () => {
  const rows = parseCsvText('a,b,c\n1,"hello, world","say ""hi"""\n2,"line1\nline2",x\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', 'hello, world', 'say "hi"'],
    ['2', 'line1\nline2', 'x'],
  ]);
});

test('CRLF, lone CR, BOM, blank lines and missing trailing newline', () => {
  assert.deepEqual(parseCsvText('﻿a,b\r\n1,2\r\n\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCsvText('a,b\r1,2\r3,4\r'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('empty fields and trailing delimiter', () => {
  assert.deepEqual(parseCsvText('a,,c\n,,\n1,2,\n'), [['a', '', 'c'], ['', '', ''], ['1', '2', '']]);
});

test('lenient: quote inside unquoted field and text after closing quote', () => {
  assert.deepEqual(parseCsvText('5" pipe,x\n"abc"def,y\n'), [['5" pipe', 'x'], ['abcdef', 'y']]);
});

test('unterminated quote reports a warning and keeps data', () => {
  const warnings: string[] = [];
  const rows: string[][] = [];
  const p = new CsvParser({ delimiter: ',', onRow: (r) => rows.push(r), onWarning: (m) => warnings.push(m) });
  p.push('a,b\n1,"oops\nstill');
  p.end();
  assert.equal(warnings.length, 1);
  assert.equal(rows.length, 2);
});

test('result is independent of how the text is chunked (random chunk sizes)', () => {
  const text =
    '﻿id,name,notes\r\n' +
    Array.from({ length: 300 }, (_, i) => `${i},"Name ""${i}""","multi\r\nline, with comma ${i}"\r\n`).join('') +
    '300,last,"end"';
  const expected = parseCsvText(text);
  assert.equal(expected.length, 302);
  const rng = mulberry32(5);
  for (let trial = 0; trial < 50; trial++) {
    const out: string[][] = [];
    const p = new CsvParser({ delimiter: ',', onRow: (r) => out.push(r) });
    let i = 0;
    while (i < text.length) {
      const n = 1 + Math.floor(rng() * 40);
      p.push(text.slice(i, i + n));
      i += n;
    }
    p.end();
    assert.deepEqual(out, expected, `trial ${trial}`);
  }
});

test('sniffDelimiter', () => {
  assert.equal(sniffDelimiter('a;b;c\n1;2;3\n4;5;6\n'), ';');
  assert.equal(sniffDelimiter('a\tb\n1\t2\n'), '\t');
  assert.equal(sniffDelimiter('a|b|c\n1|2|3\n'), '|');
  assert.equal(sniffDelimiter('a,b,c\n"1,5",2,3\n4,5,6\n'), ',');
  assert.equal(sniffDelimiter('single\ncolumn\n'), ',');
});

test('normalizeHeader makes names unique and non-empty', () => {
  assert.deepEqual(normalizeHeader(['id', '', 'id', ' name ']), ['id', 'column_2', 'id_2', 'name']);
});

test('shard planner never cuts inside a quoted multiline field', () => {
  const rows: string[] = ['id,text'];
  for (let i = 0; i < 400; i++) rows.push(`${i},"line one\nline two\n""quoted"" ${i}"`);
  const text = rows.join('\n') + '\n';
  const bytes = new TextEncoder().encode(text);
  for (const shardCount of [1, 2, 3, 5, 8]) {
    const scanner = new BoundaryScanner(true, bytes.length, shardCount);
    // feed in uneven chunks
    for (let i = 0; i < bytes.length; ) {
      const n = 1 + ((i * 31) % 97);
      scanner.push(bytes.subarray(i, i + n));
      i += n;
    }
    const ranges = rangesFrom(scanner.result());
    assert.ok(ranges.length >= 1 && ranges.length <= shardCount);
    // ranges tile the data section with no gaps
    for (let k = 1; k < ranges.length; k++) assert.equal(ranges[k].start, ranges[k - 1].end);
    assert.equal(ranges[ranges.length - 1].end, bytes.length);
    // parsing each range independently and concatenating == parsing the whole file
    const all: string[][] = [];
    for (const r of ranges) all.push(...parseCsvText(new TextDecoder().decode(bytes.subarray(r.start, r.end))));
    const whole = parseCsvText(text).slice(1);
    assert.deepEqual(all, whole, `shardCount=${shardCount}`);
  }
});

test('effectiveShardCount avoids tiny shards', () => {
  assert.equal(effectiveShardCount(8, 1000), 1);
  assert.equal(effectiveShardCount(8, 65536 * 3), 3);
  assert.equal(effectiveShardCount(4, 1e9), 4);
});
