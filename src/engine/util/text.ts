const NULL_TOKENS = new Set([
  '', 'null', 'n/a', 'na', 'n.a.', 'none', 'nan', '-', '--', '---', 'nil', 's/d', 'sd', 'sin dato', 'sin datos',
  'undefined', '#n/a', '(blank)', 'vacio', 'vacío',
]);

export function isNullToken(raw: string): boolean {
  if (raw.length === 0) return true;
  const t = raw.trim().toLowerCase();
  return NULL_TOKENS.has(t);
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Canonical form to compare category labels: trim, lower-case, no accents, single spaces. */
export function normalizeLabel(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Aggressive normalization for near-duplicate hashing: only letters and digits survive. */
export function normalizeForNear(s: string): string {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Splits a column name into lower-case tokens: "unitPrice" / "unit_price" / "Precio Unitario" -> [unit, price]. */
export function nameTokens(name: string): string[] {
  return stripAccents(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function truncate(s: string, max = 120): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
