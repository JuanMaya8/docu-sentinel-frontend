/**
 * Minimal .xlsx reader (Office Open XML spreadsheet) with no dependencies, runs in Web Workers and in Node.
 *  - ZIP: central directory + "stored" (0) and "deflate" (8) entries, inflated with DecompressionStream('deflate-raw')
 *  - reads the FIRST worksheet in workbook order, shared strings, inline strings, booleans, errors and formulas' cached values
 *  - dates: cells whose number format is a date (built-in ids or custom codes with d/m/y) become ISO `YYYY-MM-DD`
 *    (`YYYY-MM-DDTHH:MM:SS` when they carry a time); 1900 and 1904 date systems
 * Not supported (documented): .xls (binary), encrypted workbooks, merged cells are read as one value + empty cells.
 */
import type { Tabular } from './json';
import { normalizeHeader } from './csv';

const MAX_UNCOMPRESSED = 400 * 1024 * 1024;

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

export function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

// ------------------------------------------------------------------ ZIP

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function readEntries(buf: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('El archivo .xlsx está dañado (no se encontró el índice ZIP).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError('El archivo .xlsx está dañado (índice ZIP inválido).');
    const flags = dv.getUint16(p + 8, true);
    if (flags & 0x1) throw new XlsxError('El libro de Excel está protegido con contraseña; guárdalo sin cifrado.');
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new XlsxError('Este navegador no puede descomprimir archivos .xlsx; expórtalo a CSV.');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.localOffset, true) !== 0x04034b50) throw new XlsxError(`El archivo .xlsx está dañado (${e.name}).`);
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.size > MAX_UNCOMPRESSED) throw new XlsxError('La hoja de cálculo supera 400 MB descomprimida; divídela o expórtala a CSV.');
  let bytes: Uint8Array;
  if (e.method === 0) bytes = raw;
  else if (e.method === 8) bytes = await inflateRaw(raw);
  else throw new XlsxError(`Compresión ZIP no soportada (${e.method}).`);
  return new TextDecoder('utf-8').decode(bytes);
}

// ------------------------------------------------------------------ XML helpers (regex based: DOMParser is not available in workers)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e],
  );
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[2] ?? m[3] ?? '') : undefined;
}

/** Concatenates every <t>…</t> inside a fragment (rich text runs), ignoring phonetic runs (<rPh>). */
function textOf(fragment: string): string {
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

// ------------------------------------------------------------------ dates

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export function isDateFormat(code: string): boolean {
  const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(stripped) && !/^[#0.,%\s]*$/.test(stripped);
}

export function serialToIso(serial: number, date1904: boolean): string {
  const days = date1904 ? serial + 1462 : serial;
  // Excel's 1900 system counts the non-existent 1900-02-29: serial 60. Epoch 1899-12-30 handles serials > 60.
  const ms = Math.round((days - 25569) * 86_400_000);
  const d = new Date(ms);
  const iso = d.toISOString();
  return Math.abs(serial % 1) > 1e-9 ? iso.slice(0, 19) : iso.slice(0, 10);
}

// ------------------------------------------------------------------ workbook

export interface XlsxResult extends Tabular {
  sheetName: string;
}

export async function parseXlsx(input: ArrayBuffer | Uint8Array): Promise<XlsxResult> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isZip(buf)) throw new XlsxError('El archivo no es un .xlsx válido (los .xls antiguos no están soportados: guárdalo como .xlsx o CSV).');
  const entries = readEntries(buf);
  const get = async (name: string): Promise<string | null> => {
    const e = entries.get(name);
    return e ? readEntry(buf, e) : null;
  };

  const workbook = await get('xl/workbook.xml');
  if (!workbook) throw new XlsxError('El archivo no contiene un libro de Excel (falta xl/workbook.xml).');
  const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/.test(workbook);
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  if (!firstSheet) throw new XlsxError('El libro no tiene hojas.');
  const sheetName = attr(firstSheet[1], 'name') ?? 'Hoja1';
  const relId = attr(firstSheet[1], 'r:id');

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rels = await get('xl/_rels/workbook.xml.rels');
  if (rels && relId) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attr(m[1], 'Id') === relId) {
        const target = attr(m[1], 'Target') ?? '';
        sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      }
    }
  }

  const shared: string[] = [];
  const sst = await get('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(m[1] ? textOf(m[1]) : '');

  const dateStyles = new Set<number>();
  const styles = await get('xl/styles.xml');
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
      const id = Number(attr(m[1], 'numFmtId'));
      const code = attr(m[1], 'formatCode') ?? '';
      custom.set(id, code);
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
    if (xfs) {
      let i = 0;
      for (const m of xfs[1].matchAll(/<xf\b([^>]*?)(\/>|>)/g)) {
        const id = Number(attr(m[1], 'numFmtId') ?? 0);
        if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
        i++;
      }
    }
  }

  const sheet = await get(sheetPath);
  if (!sheet) throw new XlsxError(`No se encontró la hoja «${sheetName}» dentro del archivo.`);

  const grid: string[][] = [];
  let width = 0;
  let nextRow = 0;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1], 'r') ?? nextRow + 1) - 1;
    nextRow = r + 1;
    const row: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const t = attr(cm[1], 't') ?? 'n';
      const s = Number(attr(cm[1], 's') ?? 0);
      const body = cm[2] ?? '';
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (t === 's') value = v !== undefined ? shared[Number(v)] ?? '' : '';
      else if (t === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (t === 'b') value = v === '1' ? 'true' : v === '0' ? 'false' : '';
      else if (t === 'str' || t === 'e') value = v !== undefined ? decodeXml(v) : '';
      else if (v !== undefined) {
        const num = Number(v);
        value = dateStyles.has(s) && Number.isFinite(num) ? serialToIso(num, date1904) : v;
      }
      while (row.length < col) row.push('');
      row[col] = value;
    }
    while (grid.length < r) grid.push([]);
    grid[r] = row;
    if (row.length > width) width = row.length;
  }

  const nonEmpty = (row: string[] | undefined): boolean => !!row && row.some((c) => c !== '' && c !== undefined);
  const headerAt = grid.findIndex(nonEmpty);
  if (headerAt < 0) throw new XlsxError(`La hoja «${sheetName}» está vacía.`);
  const warnings: string[] = [];
  const sheetCount = (workbook.match(/<sheet\b/g) ?? []).length;
  if (sheetCount > 1) warnings.push(`El libro tiene ${sheetCount} hojas; se analizó solo la primera («${sheetName}»).`);
  const rawHeader = Array.from({ length: width }, (_, i) => grid[headerAt][i] ?? '');
  let lastCol = rawHeader.length;
  while (lastCol > 0 && rawHeader[lastCol - 1] === '' && !grid.slice(headerAt + 1).some((r) => r && (r[lastCol - 1] ?? '') !== '')) lastCol--;
  const header = normalizeHeader(rawHeader.slice(0, lastCol));
  const rows: string[][] = [];
  let skipped = 0;
  for (let r = headerAt + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!nonEmpty(row)) {
      skipped++;
      continue;
    }
    rows.push(Array.from({ length: lastCol }, (_, i) => row[i] ?? ''));
  }
  if (skipped > 0) warnings.push(`Se omitieron ${skipped.toLocaleString('es-CO')} filas completamente vacías de la hoja.`);
  if (rows.length === 0) throw new XlsxError(`La hoja «${sheetName}» solo tiene encabezado, sin registros.`);
  return { header, rows, warnings, sheetName };
}
