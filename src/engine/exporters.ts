import { RISK_LABELS_ES, TYPE_LABELS_ES } from './i18n/es';
import type { Finding } from './types';

export const CSV_HEADERS_ES = ['Registro', 'Tipo de anomalía', 'Nivel de riesgo', 'Campo afectado', 'Explicación'] as const;

export function recordLabel(f: Finding): string {
  if (f.recordIndex === null) return 'Columna completa';
  return `#${f.recordIndex + 1}${f.recordId ? ` · ${f.recordId}` : ''}`;
}

function esc(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** UTF-8 CSV with BOM so Excel shows accents correctly. */
export function findingsToCsv(findings: Finding[]): string {
  const lines = [CSV_HEADERS_ES.join(',')];
  for (const f of findings) {
    lines.push([recordLabel(f), TYPE_LABELS_ES[f.type], RISK_LABELS_ES[f.risk], f.field ?? '', f.explanation].map(esc).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function findingsToJson(findings: Finding[]): string {
  return JSON.stringify(
    findings.map((f) => ({
      registro: recordLabel(f),
      tipoDeAnomalia: TYPE_LABELS_ES[f.type],
      nivelDeRiesgo: RISK_LABELS_ES[f.risk],
      campoAfectado: f.field,
      explicacion: f.explanation,
      puntaje: f.score,
      tipo: f.type,
      indice: f.recordIndex,
    })),
    null,
    2,
  );
}
