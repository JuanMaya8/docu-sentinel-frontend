/**
 * All Spanish text produced by the engine lives here (identifiers stay in English).
 * Number format: es-CO (1.234,5). Implemented by hand so output is identical in every runtime.
 */
import type { AnomalyType, RiskLevel } from '../types';
import { epochDaysToIso } from '../util/dates';
import { truncate } from '../util/text';

export const TYPE_LABELS_ES: Record<AnomalyType, string> = {
  duplicate_exact: 'Duplicado exacto',
  duplicate_key: 'Clave duplicada',
  duplicate_near: 'Posible duplicado',
  missing_field: 'Campo faltante',
  empty_record: 'Registro casi vacío',
  type_mismatch: 'Tipo de dato inconsistente',
  invalid_format: 'Formato inválido',
  impossible_date: 'Fecha imposible',
  inconsistent_label: 'Etiqueta inconsistente',
  whitespace: 'Espacios sobrantes',
  out_of_range: 'Valor fuera de rango',
  negative_value: 'Valor negativo',
  future_date: 'Fecha futura',
  impossible_relation: 'Relación imposible',
  suspicious_threshold: 'Valor justo bajo un umbral',
  suspicious_round: 'Valores redondos sospechosos',
  benford: 'Desviación de la ley de Benford',
  multivariate_anomaly: 'Anomalía multivariante (IA)',
  mixed_types: 'Tipos mezclados en la columna',
};

export const RISK_LABELS_ES: Record<RiskLevel, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
};

export function fmtNum(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '-∞';
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const [int, dec] = rounded.toFixed(maxDecimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = dec ? dec.replace(/0+$/, '') : '';
  const sign = value < 0 && rounded !== 0 ? '-' : '';
  return sign + grouped + (decimals ? ',' + decimals : '');
}

export function fmtPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1).replace('.', ',')}%`;
  return `${pct.toFixed(2).replace('.', ',')}%`;
}

export function q(value: string): string {
  return `«${truncate(value, 60)}»`;
}

export const es = {
  missingField: (field: string, nullRate: number) =>
    `El campo ${q(field)} está vacío, pero solo el ${fmtPercent(nullRate)} de los registros lo deja vacío: se espera que esté lleno.`,
  emptyRecord: (empty: number, total: number) =>
    `El registro tiene ${empty} de ${total} campos vacíos; parece incompleto.`,
  typeMismatchNumeric: (field: string, value: string, share: number) =>
    `Se esperaba un número en ${q(field)} (${fmtPercent(share)} de los valores lo son) pero se encontró ${q(value)}.`,
  typeMismatchDate: (field: string, value: string, share: number) =>
    `Se esperaba una fecha en ${q(field)} (${fmtPercent(share)} de los valores lo son) pero se encontró ${q(value)}.`,
  typeMismatchGeneric: (field: string, value: string, expected: string) =>
    `Se esperaba ${expected} en ${q(field)} pero se encontró ${q(value)}.`,
  invalidEmail: (field: string, value: string) => `El valor ${q(value)} en ${q(field)} no es un correo electrónico válido.`,
  impossibleDate: (field: string, value: string) => `La fecha ${q(value)} en ${q(field)} no existe en el calendario.`,
  dateFormat: (field: string, value: string, expected: string) =>
    `La fecha ${q(value)} en ${q(field)} usa un formato distinto al predominante (${expected}).`,
  whitespace: (field: string, value: string) => `El valor ${q(value)} en ${q(field)} tiene espacios al inicio o al final.`,
  inconsistentLabel: (field: string, value: string, canonical: string) =>
    `${q(value)} en ${q(field)} es una variante de escritura de ${q(canonical)} (la forma más común).`,
  mixedTypes: (field: string, parts: string) => `La columna ${q(field)} mezcla tipos de dato: ${parts}.`,
  outOfRange: (field: string, value: number, median: number, deviations: number, low: number, high: number) =>
    `El valor ${fmtNum(value)} en ${q(field)} está ${fmtNum(Math.abs(deviations), 1)} desviaciones robustas ${
      value > median ? 'por encima' : 'por debajo'
    } de la mediana (${fmtNum(median)}); el rango habitual va de ${fmtNum(low)} a ${fmtNum(high)}.`,
  negative: (field: string, value: number) => `El valor ${fmtNum(value)} en ${q(field)} es negativo y casi nunca lo es en esta columna.`,
  zeroPrice: (field: string) => `El valor 0 en ${q(field)} es poco habitual para un precio o monto.`,
  impossibleAge: (field: string, value: number) => `La edad ${fmtNum(value)} en ${q(field)} no es posible.`,
  futureDate: (field: string, value: string) => `La fecha ${q(value)} en ${q(field)} está en el futuro y no debería estarlo.`,
  relationDateOrder: (later: string, laterValue: string, earlier: string, earlierValue: string) =>
    `${q(later)} (${laterValue}) es anterior a ${q(earlier)} (${earlierValue}).`,
  relationProduct: (result: string, resultValue: number, a: string, b: string, expected: number) =>
    `${q(result)} vale ${fmtNum(resultValue)} pero ${q(a)} × ${q(b)} da ${fmtNum(expected)}.`,
  relationSum: (result: string, resultValue: number, formula: string, expected: number) =>
    `${q(result)} vale ${fmtNum(resultValue)} pero ${formula} da ${fmtNum(expected)}.`,
  relationLte: (small: string, smallValue: number, big: string, bigValue: number) =>
    `${q(small)} (${fmtNum(smallValue)}) no puede ser mayor que ${q(big)} (${fmtNum(bigValue)}).`,
  duplicateExact: (firstRecord: number) => `Registro idéntico al registro #${firstRecord}.`,
  duplicateKey: (field: string, firstRecord: number) =>
    `El identificador de ${q(field)} ya aparece en el registro #${firstRecord}, pero el resto del contenido es distinto.`,
  duplicateNear: (firstRecord: number) =>
    `Casi idéntico al registro #${firstRecord} (cambian solo mayúsculas, tildes, espacios o el identificador).`,
  thresholdBunching: (field: string, value: number, threshold: number, count: number) =>
    `El valor ${fmtNum(value)} en ${q(field)} está justo por debajo de ${fmtNum(threshold)}; ${count} registros se concentran bajo ese umbral, lo que puede indicar fraccionamiento para evadir un control.`,
  roundNumbers: (field: string, share: number) =>
    `El ${fmtPercent(share)} de los valores de ${q(field)} son múltiplos exactos de 1.000; es una proporción inusual que conviene revisar.`,
  benford: (field: string, digit: number, observed: number, expected: number) =>
    `La distribución del primer dígito en ${q(field)} se aparta de la ley de Benford (el dígito ${digit} aparece ${fmtPercent(observed)} y se esperaba ${fmtPercent(expected)}).`,
  multivariate: (score: number, parts: string[]) =>
    `Registro atípico respecto al patrón general de los datos (puntuación ${fmtNum(score, 2)}). ${parts.join(' ')}`,
  mlValue: (field: string, value: number, median: number, deviation: number, kind: 'numeric' | 'date') => {
    const shown = kind === 'date' ? epochDaysToIso(value) : fmtNum(value);
    const ref = kind === 'date' ? epochDaysToIso(median) : fmtNum(median);
    return `El valor ${shown} en ${q(field)} está ${fmtNum(Math.abs(deviation), 1)} desviaciones robustas ${
      deviation > 0 ? 'por encima' : 'por debajo'
    } de la mediana (${ref}).`;
  },
  mlCoherence: (field: string, value: number, expected: number) =>
    `El valor ${fmtNum(value)} en ${q(field)} no es coherente con el resto de los campos del registro (según los demás valores se esperaría cerca de ${fmtNum(expected)}).`,
  mlMissing: (field: string, rate: number) =>
    `El campo ${q(field)} está vacío y casi nunca falta en los datos de referencia (${fmtPercent(rate)} de los registros).`,
  mlRarity: (field: string, frequency: number) =>
    `El valor en ${q(field)} es poco frecuente (aparece en ~${fmtPercent(frequency)} de los registros).`,
};

export function riskFromScore(score: number): RiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}
