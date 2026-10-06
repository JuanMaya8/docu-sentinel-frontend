import { RISK_LABELS_ES, TYPE_LABELS_ES, fmtNum, fmtPercent, type AnomalyType, type RiskLevel } from '@/engine';
import { RISK_ORDER, fmtInt } from '@/lib/format';

export interface SummaryData {
  rows: number;
  columns: number;
  findingsCount: number;
  recordsAffected: number;
  byRisk: Record<RiskLevel, number>;
  byType: Partial<Record<string, number>>;
}

const RISK_COLOR: Record<RiskLevel, string> = { critical: 'var(--critical)', high: 'var(--high)', medium: 'var(--medium)', low: 'var(--low)' };

export function RiskChip({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`chip risk-${risk}`}>
      <span className="dot" aria-hidden="true" />
      {RISK_LABELS_ES[risk]}
    </span>
  );
}

/** Server- and client-safe (no hooks). */
export function Summary({ data }: { data: SummaryData }) {
  const share = data.rows > 0 ? data.recordsAffected / data.rows : 0;
  const types = Object.entries(data.byType)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const maxType = Math.max(1, ...types.map(([, n]) => n ?? 0));
  const totalRisk = Math.max(1, RISK_ORDER.reduce((s, r) => s + (data.byRisk[r] ?? 0), 0));

  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="card stat"><b>{fmtInt(data.rows)}</b><span>registros analizados</span></div>
        <div className="card stat"><b>{fmtInt(data.findingsCount)}</b><span>hallazgos</span></div>
        <div className="card stat"><b>{fmtInt(data.recordsAffected)}</b><span>registros con problemas ({fmtPercent(share)})</span></div>
        <div className="card stat"><b style={{ color: 'var(--critical)' }}>{fmtInt((data.byRisk.critical ?? 0) + (data.byRisk.high ?? 0))}</b><span>de riesgo alto o crítico</span></div>
      </div>
      <div className="grid cols-2">
        <section className="card" aria-label="Hallazgos por nivel de riesgo">
          <h3>Por nivel de riesgo</h3>
          <svg viewBox="0 0 100 10" width="100%" height="26" role="img" aria-label={RISK_ORDER.map((r) => `${RISK_LABELS_ES[r]}: ${data.byRisk[r] ?? 0}`).join(', ')} preserveAspectRatio="none" style={{ borderRadius: 6, overflow: 'hidden' }}>
            {(() => {
              let x = 0;
              return RISK_ORDER.map((r) => {
                const w = ((data.byRisk[r] ?? 0) / totalRisk) * 100;
                const el = <rect key={r} x={x} y={0} width={w} height={10} fill={RISK_COLOR[r]} />;
                x += w;
                return el;
              });
            })()}
          </svg>
          <div className="row small" style={{ marginTop: 10 }}>
            {RISK_ORDER.map((r) => (
              <span key={r} className="row" style={{ gap: 6 }}>
                <span className="dot" style={{ color: RISK_COLOR[r] }} />
                {RISK_LABELS_ES[r]} <b className="mono">{fmtInt(data.byRisk[r] ?? 0)}</b>
              </span>
            ))}
          </div>
        </section>
        <section className="card bars" aria-label="Hallazgos por tipo de anomalía">
          <h3>Por tipo de anomalía</h3>
          {types.length === 0 && <p className="muted">Sin hallazgos. 🎉</p>}
          {types.slice(0, 9).map(([t, n]) => (
            <div className="bar" key={t}>
              <span>{TYPE_LABELS_ES[t as AnomalyType] ?? t}</span>
              <span className="track"><i style={{ width: `${((n ?? 0) / maxType) * 100}%` }} /></span>
              <span>{fmtNum(n ?? 0, 0)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
