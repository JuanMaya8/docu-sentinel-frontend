import { TYPE_LABELS_ES, fmtPercent, type AnomalyType, type Finding, type RiskLevel } from '@/engine';
import { fmtInt } from '@/lib/format';
import { RiskChip } from './Summary';

/** What each kind of finding means for the person who owns the file, and what to do about it. */
const ADVICE: Record<AnomalyType, string> = {
  duplicate_exact: 'Filas idénticas repetidas. Elimina las copias para no contar dos veces lo mismo.',
  duplicate_key: 'El mismo identificador aparece con datos distintos. Confirma cuál es el correcto.',
  duplicate_near: 'Registros casi iguales. Revisa si son el mismo con un error de escritura.',
  missing_field: 'Faltan datos en columnas que normalmente vienen llenas. Complétalos.',
  empty_record: 'Filas casi vacías. Probablemente sobran o se cargaron mal.',
  type_mismatch: 'Hay texto donde se esperaba un número o una fecha. Corrige el valor.',
  invalid_format: 'Correos, teléfonos, fechas u otros datos mal escritos. Corrígelos.',
  impossible_date: 'Fechas que no existen en el calendario. Corrígelas.',
  inconsistent_label: 'El mismo valor escrito de varias formas. Unifica la escritura.',
  whitespace: 'Espacios de más al inicio o al final del texto. Límpialos.',
  out_of_range: 'Valores mucho más altos o bajos de lo normal. Confirma que sean correctos.',
  negative_value: 'Valores negativos donde no deberían existir. Revisa el signo.',
  future_date: 'Fechas en el futuro. Verifica si son errores de digitación.',
  impossible_relation: 'Cuentas que no cuadran, por ejemplo un total que no es la suma de sus partes. Revisa los cálculos.',
  suspicious_threshold: 'Montos justo por debajo de un límite de aprobación. Pueden indicar compras fraccionadas.',
  suspicious_round: 'Demasiados valores redondos. Podrían ser estimados y no valores reales.',
  benford: 'Los montos no se distribuyen como suelen hacerlo los datos reales. Pueden haber sido inventados o alterados.',
  multivariate_anomaly: 'La IA encontró registros que no se parecen al resto. Revísalos uno por uno.',
  mixed_types: 'Una columna mezcla números y texto. Unifica el formato.',
};

const RANK: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const MAX_CARDS = 6;

export interface ActionPlanProps {
  rows: number;
  recordsAffected: number;
  totalFindings: number;
  byRisk: Record<RiskLevel, number>;
  byType: Partial<Record<string, number>>;
  findings: Finding[];
  /** Show a group in the table below (no arguments = most urgent first). */
  onShow: (filter: { type?: AnomalyType; urgentFirst?: boolean }) => void;
}

/** "Qué revisar primero": a plain-language to-do list built from the findings. */
export function ActionPlan({ rows, recordsAffected, totalFindings, byRisk, byType, findings, onShow }: ActionPlanProps) {
  const worst = new Map<AnomalyType, RiskLevel>();
  for (const f of findings) {
    const w = worst.get(f.type);
    if (!w || RANK[f.risk] > RANK[w]) worst.set(f.type, f.risk);
  }
  const groups = (Object.entries(byType) as Array<[AnomalyType, number | undefined]>)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([type, n]) => ({ type, count: n ?? 0, risk: worst.get(type) ?? 'low' }))
    .sort((a, b) => RANK[b.risk] - RANK[a.risk] || b.count - a.count);
  const urgent = (byRisk.critical ?? 0) + (byRisk.high ?? 0);
  const share = rows > 0 ? recordsAffected / rows : 0;

  if (totalFindings === 0) {
    return (
      <section className="card plan-head ok" aria-label="Resultado">
        <h2>Todo en orden</h2>
        <p style={{ margin: 0 }}>No encontramos problemas en los {fmtInt(rows)} registros de este archivo.</p>
      </section>
    );
  }

  return (
    <section className="stack" aria-label="Qué revisar primero">
      <div className="card plan-head">
        <h2>Encontramos {fmtInt(totalFindings)} posibles problemas en {fmtInt(recordsAffected)} de {fmtInt(rows)} registros ({fmtPercent(share)})</h2>
        <p style={{ margin: 0 }}>
          {urgent > 0
            ? <><b>{fmtInt(urgent)}</b> son urgentes (riesgo alto o crítico): empieza por ellos.</>
            : 'Ninguno es urgente: son detalles de calidad que conviene corregir.'}
        </p>
        <div className="row">
          <button className="btn primary" onClick={() => onShow({ urgentFirst: true })}>Ver los más urgentes</button>
        </div>
      </div>

      <h2 style={{ marginBottom: 0 }}>Qué revisar primero</h2>
      <div className="grid cols-3">
        {groups.slice(0, MAX_CARDS).map((g) => (
          <article className="card plan-card" key={g.type}>
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{TYPE_LABELS_ES[g.type]}</h3>
              <RiskChip risk={g.risk} />
            </div>
            <p className="small muted" style={{ margin: 0 }}>{ADVICE[g.type]}</p>
            <button className="btn sm" onClick={() => onShow({ type: g.type })}>Ver {g.count === 1 ? 'el caso' : `los ${fmtInt(g.count)} casos`}</button>
          </article>
        ))}
      </div>
      {groups.length > MAX_CARDS && (
        <p className="small muted" style={{ margin: 0 }}>Hay {groups.length - MAX_CARDS} tipos de problema más; los ves todos en la tabla de abajo.</p>
      )}
    </section>
  );
}
