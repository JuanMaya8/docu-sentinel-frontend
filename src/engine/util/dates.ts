/** Date parsing without locale surprises. Everything is UTC "epoch days" (days since 1970-01-01). */
export type DateOrder = 'dmy' | 'mdy';

export type DateFormat = 'iso' | 'ymd_slash' | 'dmy_slash' | 'dmy_dash' | 'dmy_dot' | 'mdy';

export interface ParsedDate {
  /** epoch days, or NaN when the text matches a date pattern but is impossible (e.g. 31/02/2025). */
  days: number;
  format: DateFormat;
  impossible: boolean;
}

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const RE_YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const RE_DMY = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const dim = m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1];
  return d <= dim;
}

export function ymdToEpochDays(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function epochDaysToIso(days: number): string {
  if (!Number.isFinite(days)) return '';
  return new Date(Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}

/** Returns null when the text does not look like a date at all. */
export function parseDate(raw: string, order: DateOrder = 'dmy'): ParsedDate | null {
  const s = raw.trim();
  if (s.length < 6 || s.length > 32) return null;
  let m = RE_ISO.exec(s);
  if (m) return build(+m[1], +m[2], +m[3], 'iso');
  m = RE_YMD_SLASH.exec(s);
  if (m) return build(+m[1], +m[2], +m[3], 'ymd_slash');
  m = RE_DMY.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[3];
    const y = +m[4];
    const sep = m[2];
    const dmyFormat: DateFormat = sep === '/' ? 'dmy_slash' : sep === '-' ? 'dmy_dash' : 'dmy_dot';
    const dmyOk = validYmd(y, b, a);
    const mdyOk = validYmd(y, a, b);
    const asDmy: ParsedDate = { days: dmyOk ? ymdToEpochDays(y, b, a) : NaN, format: dmyFormat, impossible: false };
    const asMdy: ParsedDate = { days: mdyOk ? ymdToEpochDays(y, a, b) : NaN, format: 'mdy', impossible: false };
    if (order === 'dmy') {
      if (dmyOk) return asDmy;
      if (mdyOk) return asMdy; // e.g. 12/25/2025 inside a day-first column
    } else {
      if (mdyOk) return asMdy;
      if (dmyOk) return asDmy;
    }
    return { days: NaN, format: dmyFormat, impossible: true };
  }
  return null;
}

function build(y: number, mo: number, d: number, format: DateFormat): ParsedDate {
  if (!validYmd(y, mo, d)) return { days: NaN, format, impossible: true };
  return { days: ymdToEpochDays(y, mo, d), format, impossible: false };
}

export function looksLikeDate(raw: string): boolean {
  return parseDate(raw) !== null;
}
