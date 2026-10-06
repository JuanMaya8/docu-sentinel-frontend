import type { AnomalyType, ColumnProfile, DatasetProfile, Finding } from '../types';
import { es, riskFromScore } from '../i18n/es';

const BENFORD = [0.30103, 0.17609, 0.12494, 0.09691, 0.07918, 0.06695, 0.05799, 0.05115, 0.04576];
const CHI2_CRITICAL_DF8_P001 = 26.125;

function columnFinding(col: ColumnProfile, type: AnomalyType, score: number, explanation: string, detector: string): Finding {
  return { recordIndex: null, type, risk: riskFromScore(score), score, field: col.name, explanation, detector };
}

export function benfordStats(digits: number[]): { n: number; chi2: number; mad: number; worst: number } {
  const n = digits.reduce((a, b) => a + b, 0);
  let chi2 = 0;
  let mad = 0;
  let worst = 0;
  let worstDiff = -1;
  for (let i = 0; i < 9; i++) {
    const expected = BENFORD[i] * n;
    chi2 += (digits[i] - expected) ** 2 / expected;
    const diff = Math.abs(digits[i] / n - BENFORD[i]);
    mad += diff / 9;
    if (diff > worstDiff) {
      worstDiff = diff;
      worst = i + 1;
    }
  }
  return { n, chi2, mad, worst };
}

/** Findings that describe a whole column rather than a row. Computed once from the global profile. */
export function columnLevelFindings(profile: DatasetProfile, enabled: { types: boolean; suspicious: boolean }): Finding[] {
  const out: Finding[] = [];
  for (const col of profile.columns) {
    if (enabled.types && col.type === 'mixed') {
      const parts = Object.entries(col.typeShares)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3)
        .map(([t, share]) => `${Math.round((share ?? 0) * 100)}% ${typeNameEs(t)}`)
        .join(', ');
      out.push(columnFinding(col, 'mixed_types', 50, es.mixedTypes(col.name, parts), 'types'));
    }
    if (!enabled.suspicious) continue;
    if (col.numeric && col.leadingDigits && col.role.amount && !col.role.identifier) {
      const n = col.numeric.n;
      // round numbers
      if (n >= 200 && col.numeric.median >= 10_000 && col.multiplesOf1000 / n >= 0.4) {
        out.push(columnFinding(col, 'suspicious_round', 30, es.roundNumbers(col.name, col.multiplesOf1000 / n), 'suspicious'));
      }
      // Benford: only meaningful for many values spanning several orders of magnitude
      const spansOrders = col.numeric.p01 > 0 && col.numeric.p99 / col.numeric.p01 >= 100;
      const b = benfordStats(col.leadingDigits);
      if (b.n >= 1000 && spansOrders && b.chi2 > CHI2_CRITICAL_DF8_P001 && b.mad > 0.015) {
        const observed = col.leadingDigits[b.worst - 1] / b.n;
        out.push(columnFinding(col, 'benford', 40, es.benford(col.name, b.worst, observed, BENFORD[b.worst - 1]), 'suspicious'));
      }
    }
  }
  return out;
}

function typeNameEs(t: string): string {
  switch (t) {
    case 'integer':
    case 'decimal':
      return 'numérico';
    case 'date':
      return 'fecha';
    case 'boolean':
      return 'sí/no';
    case 'email':
      return 'correo';
    default:
      return 'texto';
  }
}
