/**
 * PDF -> table. Pure layout heuristics (testable without pdf.js) + a thin pdf.js adapter.
 *
 * Strategy: group text items into lines by their Y coordinate, split each line into cells where the
 * horizontal gap is large, then take the longest run of lines with the same (>=3) number of cells as
 * the table (first line = header). If there is no table, "Label: value" lines become one record.
 * This works for text-based PDFs (invoices, reports exported from systems), NOT for scanned images (no OCR).
 */
import type { Tabular } from './json';
import { normalizeHeader } from './csv';

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** Minimal slice of the pdf.js API that we use (lets the app choose how to load/bundle pdf.js). */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array } & Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<Record<string, unknown>> }> }>;
    }>;
  };
}

export function groupLines(items: TextItem[], yTolerance = 3): TextItem[][] {
  const sorted = items.filter((i) => i.str.trim().length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= yTolerance) last.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines;
}

/** Splits a line into cells; gap threshold adapts to the glyph width of the line. */
export function lineToCells(line: TextItem[]): string[] {
  const cells: string[] = [];
  let cur = '';
  let prevEnd = -Infinity;
  const charWidths = line.map((i) => (i.str.length > 0 ? i.width / i.str.length : 0)).filter((w) => w > 0);
  const avg = charWidths.length ? charWidths.reduce((a, b) => a + b, 0) / charWidths.length : 5;
  const cellGap = Math.max(avg * 2.2, 8);
  for (const it of line) {
    const gap = it.x - prevEnd;
    if (cur.length > 0 && gap > cellGap) {
      cells.push(cur.trim());
      cur = it.str;
    } else if (cur.length > 0) {
      cur += gap > avg * 0.3 ? ' ' + it.str : it.str;
    } else cur = it.str;
    prevEnd = it.x + it.width;
  }
  if (cur.trim().length > 0) cells.push(cur.trim());
  return cells;
}

export function detectTable(lines: string[][]): { header: string[]; rows: string[][]; consumed: Set<number> } | null {
  let best: { start: number; end: number; width: number } | null = null;
  let i = 0;
  while (i < lines.length) {
    const width = lines[i].length;
    if (width < 3) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].length === width) j++;
    if (j - i >= 3 && (!best || j - i > best.end - best.start)) best = { start: i, end: j, width };
    i = j;
  }
  if (!best) return null;
  const consumed = new Set<number>();
  for (let k = best.start; k < best.end; k++) consumed.add(k);
  return { header: lines[best.start], rows: lines.slice(best.start + 1, best.end), consumed };
}

export function keyValues(lines: string[][]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const cells of lines) {
    const joined = cells.join(' ');
    const m = /^([^:]{1,40}):\s*(.+)$/.exec(joined);
    if (m) out.push([m[1].trim(), m[2].trim()]);
    else if (cells.length === 2 && cells[0].endsWith(':')) out.push([cells[0].slice(0, -1).trim(), cells[1]]);
  }
  return out;
}

export function linesToTabular(pages: string[][][]): Tabular {
  const warnings: string[] = [];
  const tables = pages.map((p) => detectTable(p));
  const first = tables.find((t) => t !== null);
  if (first) {
    const header = normalizeHeader(first.header);
    const rows: string[][] = [];
    for (const t of tables) {
      if (!t) continue;
      if (t.header.length !== header.length) {
        warnings.push('El PDF contiene tablas con distinto número de columnas; solo se usó la primera forma de tabla.');
        continue;
      }
      // skip a repeated header on later pages
      for (const r of t.rows) rows.push(r);
    }
    const headerFields = pages.flatMap((p) => keyValues(p)).length;
    if (headerFields > 0) warnings.push(`Se ignoraron ${headerFields} campos de encabezado fuera de la tabla del PDF.`);
    return { header, rows, warnings };
  }
  const kv = pages.flatMap((p) => keyValues(p));
  if (kv.length >= 2) {
    warnings.push('El PDF no contiene una tabla; se extrajo un único registro con los campos «Etiqueta: valor».');
    return { header: normalizeHeader(kv.map(([k]) => k)), rows: [kv.map(([, v]) => v)], warnings };
  }
  throw new Error('No se pudo extraer una estructura tabular del PDF (¿es un documento escaneado sin texto?).');
}

export async function extractPdfTable(data: ArrayBuffer, pdfjs: PdfJsLike): Promise<Tabular> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true }).promise;
  const pages: string[][][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items) {
      const str = raw.str;
      const tr = raw.transform as number[] | undefined;
      if (typeof str !== 'string' || !tr) continue;
      items.push({ str, x: tr[4], y: tr[5], width: typeof raw.width === 'number' ? raw.width : str.length * 5 });
    }
    pages.push(groupLines(items).map(lineToCells));
  }
  return linesToTabular(pages);
}
