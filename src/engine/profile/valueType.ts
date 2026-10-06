import type { ValueType } from '../types';
import { isNullToken } from '../util/text';
import { numberShape, type StyleHint } from '../util/numbers';
import { parseDate, type ParsedDate } from '../util/dates';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BOOL_WORDS = new Set(['true', 'false', 'si', 'sí', 'no', 'yes', 'verdadero', 'falso']);

export interface Classified {
  type: ValueType;
  hint?: StyleHint;
  date?: ParsedDate;
}

const NULL: Classified = { type: 'null' };
const STRING: Classified = { type: 'string' };

/** Classifies one raw cell. Hot path: cheap pre-checks first. */
export function classifyValue(raw: string): Classified {
  const len = raw.length;
  if (len === 0) return NULL;
  const first = raw.charCodeAt(0);
  const numericStart =
    (first >= 48 && first <= 57) || first === 45 || first === 43 || first === 46 || first === 40 || first === 36 || first === 8364 || first === 163;
  if (numericStart || first === 32) {
    const t = raw.trim();
    if (t.length === 0) return NULL;
    const date = parseDate(t);
    if (date) return { type: 'date', date };
    const shape = numberShape(t);
    if (shape) return { type: shape.integer ? 'integer' : 'decimal', hint: shape.hint };
    if (isNullToken(t)) return NULL;
    return STRING;
  }
  if (len <= 14 && isNullToken(raw)) return NULL;
  if (raw.includes('@') && RE_EMAIL.test(raw.trim())) return { type: 'email' };
  if (len <= 10 && BOOL_WORDS.has(raw.trim().toLowerCase())) return { type: 'boolean' };
  // currency prefixes such as "COP 1.200"
  if (len <= 24 && /^(?:cop|usd|eur)\s/i.test(raw)) {
    const shape = numberShape(raw);
    if (shape) return { type: shape.integer ? 'integer' : 'decimal', hint: shape.hint };
  }
  return STRING;
}
