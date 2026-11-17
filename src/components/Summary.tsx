import { RISK_LABELS_ES, TYPE_LABELS_ES, fmtNum, fmtPercent, type AnomalyType, type RiskLevel } from '@/engine';
import { RISK_ORDER, fmtInt } from '@/lib/format';
import { Icon } from './Icon';

export interface SummaryData {
  rows: number;
  columns: number;
  findingsCount: number;
  recordsAffected: number;
  byRisk: Record<RiskLevel, number>;
  byType: Partial<Record<string, number>>;
}

export const RISK_COLOR: Record<RiskLevel, string> = { critical: 'var(--critical)', high: 'var(--high)', medium: 'var(--medium)', low: 'var(--low)' };

export function RiskChip({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`chip risk-${risk}`}>
      <span className="dot" aria-hidden="true" />
      {RISK_LABELS_ES[risk]}
    </span>
  );
}

/** The four headline numbers. Server- and client-safe (no hooks). */
export function SummaryStats({ data }: { data: SummaryData }) {
  const share = data.rows > 0 ? data.recordsAffected / data.rows : 0;
  const urgent = (data.byRisk.critical ?? 0) + (data.byRisk.high ?? 0);
  return (
    <div className="grid cols-4 stats">
      <div className="card stat">
        <span className="stat-label">Registros revisados <Icon name="table" size={16} /></span>
        <b>{fmtInt(data.rows)}</b>
        <span>{fmtInt(data.columns)} columnas</span>
      </div>
      <div className="card stat">
        <span className="stat-label">Hallazgos <Icon name="alert" size={16} /></span>
        <b>{fmtInt(data.findingsCount)}</b>
        <span>en {fmtInt(data.recordsAffected)} registros ({fmtPercent(share)})</span>
      </div>
      <div className="card stat">
        <span className="stat-label">Severidad <Icon name="barChart" size={16} /></span>
        <div className="sev-grid">
          {RISK_ORDER.map((r) => (
            <span key={r} className={`chip risk-${r}`}>
              <span className="dot" aria-hidden="true" />
              {RISK_LABELS_ES[r]}: {fmtInt(data.byRisk[r] ?? 0)}
            </span>
          ))}
        </div>
      </div>
      <div className="card stat">
        <span className="stat-label">Urgentes <Icon name="shield" size={16} /></span>
        <b style={{ color: urgent > 0 ? 'var(--critical-text)' : undefined }}>{fmtInt(urgent)}</b>
        <span>de riesgo alto o crítico</span>
      </div>
    </div>
  );
}

/** Distribution by risk level and by kind of problem. */
export function SummaryCharts({ data }: { data: SummaryData }) {
  const types = Object.entries(data.byType)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const maxType = Math.max(1, ...types.map(([, n]) => n ?? 0));
  const totalRisk = Math.max(1, RISK_ORDER.reduce((s, r) => s + (data.byRisk[r] ?? 0), 0));

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <section className="card" aria-label="Hallazgos por nivel de riesgo">
        <div className="card-head"><h3 className="card-title">Por nivel de riesgo</h3></div>
        <svg viewBox="0 0 100 10" width="100%" height="14" role="img" aria-label={RISK_ORDER.map((r) => `${RISK_LABELS_ES[r]}: ${data.byRisk[r] ?? 0}`).join(', ')} preserveAspectRatio="none" style={{ borderRadius: 999, overflow: 'hidden', display: 'block' }}>
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
        <div className="row small" style={{ marginTop: 12 }}>
          {RISK_ORDER.map((r) => (
            <span key={r} className="row" style={{ gap: 6 }}>
              <span className="dot" style={{ color: RISK_COLOR[r] }} aria-hidden="true" />
              {RISK_LABELS_ES[r]} <b className="mono">{fmtInt(data.byRisk[r] ?? 0)}</b>
            </span>
          ))}
        </div>
      </section>
      <section className="card bars" aria-label="Hallazgos por tipo de problema">
        <div className="card-head"><h3 className="card-title">Por tipo de problema</h3></div>
        {types.length === 0 && <p className="muted" style={{ margin: 0 }}>Sin hallazgos.</p>}
        {types.slice(0, 9).map(([t, n]) => (
          <div className="bar" key={t}>
            <span>{TYPE_LABELS_ES[t as AnomalyType] ?? t}</span>
            <span className="track"><i style={{ width: `${((n ?? 0) / maxType) * 100}%` }} /></span>
            <span>{fmtNum(n ?? 0, 0)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Numbers + charts (saved report page). */
export function Summary({ data }: { data: SummaryData }) {
  return (
    <div className="stack">
      <SummaryStats data={data} />
      <SummaryCharts data={data} />
    </div>
  );
}
