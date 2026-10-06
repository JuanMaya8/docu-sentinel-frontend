/**
 * Incremental RFC 4180 CSV parser (state machine).
 *
 * - Accepts text in ARBITRARY chunks: the result is identical for any chunking
 *   (tested with random chunk sizes), so it can be fed from a streaming file reader.
 * - Handles quoted fields, escaped quotes (""), embedded newlines, CRLF / LF / lone CR, and a BOM.
 * - Lenient: stray quotes inside unquoted fields are literal; text after a closing quote is appended.
 */
export interface CsvParserOptions {
  delimiter: string;
  onRow: (fields: string[]) => void;
  onWarning?: (message: string) => void;
  /** skip rows that consist of a single empty field (blank lines). Default true. */
  skipBlankLines?: boolean;
}

const enum S {
  FieldStart = 0,
  Unquoted = 1,
  Quoted = 2,
  QuoteInQuoted = 3,
}

export class CsvParser {
  private state: S = S.FieldStart;
  private cur = '';
  private fields: string[] = [];
  private skipLf = false;
  private first = true;
  private readonly d: number;
  private readonly skipBlank: boolean;
  rows = 0;

  constructor(private readonly opts: CsvParserOptions) {
    if (opts.delimiter.length !== 1) throw new Error('delimiter must be a single character');
    this.d = opts.delimiter.charCodeAt(0);
    this.skipBlank = opts.skipBlankLines ?? true;
  }

  private endField(): void {
    this.fields.push(this.cur);
    this.cur = '';
  }

  private endRow(): void {
    const f = this.fields;
    this.fields = [];
    if (this.skipBlank && f.length === 1 && f[0] === '') return;
    this.rows++;
    this.opts.onRow(f);
  }

  push(chunk: string): void {
    let text = chunk;
    if (this.first && text.length > 0) {
      this.first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    const n = text.length;
    const d = this.d;
    let i = 0;
    while (i < n) {
      if (this.skipLf) {
        this.skipLf = false;
        if (text.charCodeAt(i) === 10) {
          i++;
          continue;
        }
      }
      switch (this.state) {
        case S.FieldStart: {
          const c = text.charCodeAt(i);
          if (c === 34) {
            this.state = S.Quoted;
            i++;
          } else if (c === d) {
            this.endField();
            i++;
          } else if (c === 10) {
            this.endField();
            this.endRow();
            i++;
          } else if (c === 13) {
            this.endField();
            this.endRow();
            this.skipLf = true;
            i++;
          } else {
            this.state = S.Unquoted;
          }
          break;
        }
        case S.Unquoted: {
          const start = i;
          while (i < n) {
            const c = text.charCodeAt(i);
            if (c === d || c === 10 || c === 13) break;
            i++;
          }
          this.cur += text.slice(start, i);
          if (i < n) {
            const c = text.charCodeAt(i);
            this.endField();
            if (c === d) {
              this.state = S.FieldStart;
            } else {
              this.endRow();
              this.state = S.FieldStart;
              if (c === 13) this.skipLf = true;
            }
            i++;
          }
          break;
        }
        case S.Quoted: {
          const q = text.indexOf('"', i);
          if (q === -1) {
            this.cur += text.slice(i);
            i = n;
          } else {
            this.cur += text.slice(i, q);
            this.state = S.QuoteInQuoted;
            i = q + 1;
          }
          break;
        }
        case S.QuoteInQuoted: {
          const c = text.charCodeAt(i);
          if (c === 34) {
            this.cur += '"';
            this.state = S.Quoted;
            i++;
          } else if (c === d) {
            this.endField();
            this.state = S.FieldStart;
            i++;
          } else if (c === 10 || c === 13) {
            this.endField();
            this.endRow();
            this.state = S.FieldStart;
            if (c === 13) this.skipLf = true;
            i++;
          } else {
            this.state = S.Unquoted; // lenient: `"abc"def` -> abcdef
          }
          break;
        }
      }
    }
  }

  /** Flush the last record. Call exactly once after the last chunk. */
  end(): void {
    if (this.state === S.Quoted) {
      this.opts.onWarning?.('Comilla sin cerrar al final del archivo: el último registro puede estar incompleto.');
    }
    if (this.state !== S.FieldStart || this.cur.length > 0 || this.fields.length > 0) {
      this.endField();
      this.endRow();
    }
    this.state = S.FieldStart;
  }
}

/** Convenience for tests and small inputs. */
export function parseCsvText(text: string, delimiter = ','): string[][] {
  const out: string[][] = [];
  const p = new CsvParser({ delimiter, onRow: (r) => out.push(r) });
  p.push(text);
  p.end();
  return out;
}

/** Picks the delimiter whose per-line count is highest and most consistent in the sample. */
export function sniffDelimiter(sample: string): string {
  const candidates = [',', ';', '\t', '|'];
  const lines = sample.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 25);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = -Infinity;
  for (const c of candidates) {
    const counts = lines.map((l) => countOutsideQuotes(l, c));
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (mean < 1) continue;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    const score = mean - variance * 3;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, ch: string): number {
  let inQ = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c === ch) n++;
  }
  return n;
}

/** Makes header names unique and non-empty. */
export function normalizeHeader(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = h.trim();
    if (name.length === 0) name = `column_${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}
