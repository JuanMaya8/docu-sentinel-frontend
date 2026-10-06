/** JSON / NDJSON -> tabular rows (all cells are strings, like CSV). */

export interface Tabular {
  header: string[];
  rows: string[][];
  warnings: string[];
}

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Flattens nested objects with dot notation. Arrays of primitives are joined; arrays of objects are kept as JSON text. */
export function flattenRecord(obj: unknown, prefix = '', out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out[prefix || 'value'] = Array.isArray(obj) && obj.every((x) => x === null || typeof x !== 'object') ? obj.join('; ') : obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && depth < 6) {
      flattenRecord(v, key, out, depth + 1);
    } else if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) {
      out[key] = v.join('; ');
    } else {
      out[key] = v;
    }
  }
  return out;
}

export function recordsToTabular(records: unknown[], header?: string[]): Tabular {
  const flat = records.map((r) => flattenRecord(r));
  let cols = header;
  if (!cols) {
    const seen = new Set<string>();
    cols = [];
    for (const rec of flat) {
      for (const k of Object.keys(rec)) {
        if (!seen.has(k)) {
          seen.add(k);
          cols.push(k);
        }
      }
    }
  }
  const warnings: string[] = [];
  const rows = flat.map((rec) => cols!.map((c) => cellToString(rec[c])));
  return { header: cols, rows, warnings };
}

/** Finds the array of records inside a JSON document. */
export function extractRecords(doc: unknown): { records: unknown[]; warnings: string[] } {
  const warnings: string[] = [];
  if (Array.isArray(doc)) {
    if (doc.length > 0 && doc.every((x) => Array.isArray(x))) {
      // array of arrays -> objects with positional names
      const arrays = doc as unknown[][];
      const width = Math.max(...arrays.map((a) => a.length));
      const records = arrays.map((a) => Object.fromEntries(Array.from({ length: width }, (_, i) => [`col_${i + 1}`, a[i]])));
      return { records, warnings };
    }
    if (doc.every((x) => x === null || typeof x !== 'object')) {
      return { records: doc.map((v) => ({ value: v })), warnings };
    }
    return { records: doc, warnings };
  }
  if (doc !== null && typeof doc === 'object') {
    const entries = Object.entries(doc as Record<string, unknown>).filter(
      ([, v]) => Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object'),
    );
    if (entries.length >= 1) {
      entries.sort((a, b) => (b[1] as unknown[]).length - (a[1] as unknown[]).length);
      if (entries.length > 1) {
        warnings.push(`El JSON contiene varias listas; se analizó «${entries[0][0]}» (${(entries[0][1] as unknown[]).length} registros).`);
      }
      return { records: entries[0][1] as unknown[], warnings };
    }
    return { records: [doc], warnings };
  }
  return { records: [{ value: doc }], warnings };
}

export function parseJsonText(text: string): Tabular {
  const doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
  const { records, warnings } = extractRecords(doc);
  const t = recordsToTabular(records);
  return { ...t, warnings: [...warnings, ...t.warnings] };
}

/** Header discovery for NDJSON from the first lines (keys that only appear later are reported as a warning). */
export function discoverNdjsonHeader(lines: string[]): { header: string[]; warnings: string[] } {
  const seen = new Set<string>();
  const header: string[] = [];
  let bad = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const rec = flattenRecord(JSON.parse(line));
      for (const k of Object.keys(rec)) {
        if (!seen.has(k)) {
          seen.add(k);
          header.push(k);
        }
      }
    } catch {
      bad++;
    }
  }
  const warnings: string[] = [];
  if (bad > 0) warnings.push(`${bad} línea(s) de las primeras ${lines.length} no son JSON válido.`);
  return { header, warnings };
}

export function parseNdjsonLine(line: string, header: string[]): string[] | null {
  if (line.trim().length === 0) return null;
  const rec = flattenRecord(JSON.parse(line));
  return header.map((c) => cellToString(rec[c]));
}
