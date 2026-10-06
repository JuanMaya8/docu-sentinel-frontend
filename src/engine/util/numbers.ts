/**
 * Locale-tolerant number parsing. Colombian data often uses "1.234,56" while exports from
 * other systems use "1,234.56". The decimal style is decided PER COLUMN by majority vote of
 * the unambiguous values.
 */
export type NumberStyle = 'dot' | 'comma';
/** What a single string tells us about the decimal style of its column. */
export type StyleHint = NumberStyle | 'ambiguous' | 'neutral';

const CURRENCY = /^(?:cop|usd|eur|\$|€|£)\s*|\s*(?:cop|usd|eur|\$|€|£)$/gi;

const RE_INT = /^[+-]?\d+$/;
const RE_DEC_DOT = /^[+-]?\d*\.\d+$/;
const RE_DEC_COMMA = /^[+-]?\d*,\d+$/;
const RE_THOUSANDS_DOT = /^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/; // 1.234.567 or 1.234,56
const RE_THOUSANDS_COMMA = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/; // 1,234,567 or 1,234.56
const RE_EXP = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

export function cleanNumberText(raw: string): { text: string; negative: boolean } {
  let t = raw.trim().replace(CURRENCY, '').replace(/[\s ']/g, '');
  let negative = false;
  if (t.startsWith('(') && t.endsWith(')')) {
    negative = true;
    t = t.slice(1, -1);
  }
  return { text: t, negative };
}

export interface NumberShape {
  integer: boolean;
  hint: StyleHint;
}

/** Returns null when the text is not a number in any supported notation. */
export function numberShape(raw: string): NumberShape | null {
  const { text } = cleanNumberText(raw);
  if (text.length === 0 || text.length > 40) return null;
  if (RE_INT.test(text)) return { integer: true, hint: 'neutral' };
  if (RE_EXP.test(text)) return { integer: false, hint: 'neutral' };
  const thousandsDot = RE_THOUSANDS_DOT.test(text);
  const thousandsComma = RE_THOUSANDS_COMMA.test(text);
  const decDot = RE_DEC_DOT.test(text);
  const decComma = RE_DEC_COMMA.test(text);
  if (!thousandsDot && !thousandsComma && !decDot && !decComma) return null;
  // "1.234" -> could be 1234 (comma style) or 1.234 (dot style)
  if (thousandsDot && decDot && !text.includes(',')) return { integer: false, hint: 'ambiguous' };
  if (thousandsComma && decComma && !text.includes('.')) return { integer: false, hint: 'ambiguous' };
  if (thousandsDot) return { integer: !text.includes(','), hint: 'comma' };
  if (thousandsComma) return { integer: !text.includes('.'), hint: 'dot' };
  if (decDot) return { integer: false, hint: 'dot' };
  return { integer: false, hint: 'comma' };
}

/** Parses with the column style. Returns NaN when not numeric. */
export function parseNumber(raw: string, style: NumberStyle): number {
  const { text, negative } = cleanNumberText(raw);
  if (text.length === 0) return NaN;
  let t = text;
  if (style === 'comma') t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return NaN;
  const v = Number(t);
  if (!Number.isFinite(v)) return NaN;
  return negative ? -Math.abs(v) : v;
}

/** First significant digit (1-9) of |x|, exact (uses exponent notation, not logarithms). */
export function leadingDigit(x: number): number {
  const a = Math.abs(x);
  if (a === 0 || !Number.isFinite(a)) return 0;
  return a.toExponential().charCodeAt(0) - 48;
}
