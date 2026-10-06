'use client';

import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { RISK_LABELS_ES, TYPE_LABELS_ES, type AnomalyType, type Finding, type RiskLevel } from '@/engine';
import { recordLabel } from '@/engine/exporters';
import { RiskChip } from './Summary';
import { fmtInt } from '@/lib/format';

const ROW_H = 64;
const OVERSCAN = 8;
const RISK_RANK: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };
type SortKey = 'score' | 'record' | 'risk';

/**
 * Report table: Registro · Tipo de anomalía · Nivel de riesgo · Campo afectado · Explicación.
 * Virtualised by hand (only ~20 rows exist in the DOM) so 200 000 findings scroll at 60 fps without any dependency.
 */
export function ReportTable({ findings, onOpen, selected }: { findings: Finding[]; onOpen?: (f: Finding) => void; selected?: Finding | null }) {
  const [risk, setRisk] = useState<RiskLevel | ''>('');
  const [type, setType] = useState<AnomalyType | ''>('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('score');
  const [scrollTop, setScrollTop] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);

  const presentTypes = useMemo(() => [...new Set(findings.map((f) => f.type))].sort((a, b) => TYPE_LABELS_ES[a].localeCompare(TYPE_LABELS_ES[b], 'es')), [findings]);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let out = findings.filter((f) => (!risk || f.risk === risk) && (!type || f.type === type));
    if (q) out = out.filter((f) => (f.field ?? '').toLowerCase().includes(q) || f.explanation.toLowerCase().includes(q) || (f.recordId ?? '').toLowerCase().includes(q) || (f.value ?? '').toLowerCase().includes(q) || recordLabel(f).toLowerCase().includes(q));
    if (sort === 'record') out = [...out].sort((a, b) => (a.recordIndex ?? -1) - (b.recordIndex ?? -1) || b.score - a.score);
    else if (sort === 'risk') out = [...out].sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || b.score - a.score);
    return out; // `findings` already arrives sorted by score desc
  }, [findings, risk, type, deferredQuery, sort]);

  const height = 520;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  const resetScroll = (): void => {
    setScrollTop(0);
    if (body.current) body.current.scrollTop = 0;
  };
  const onKey = (e: KeyboardEvent, f: Finding): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.(f);
    }
  };

  return (
    <section className="stack" aria-label="Reporte de anomalías">
      <div className="row spread">
        <div className="row">
          <div className="field">
            <label htmlFor="f-risk">Riesgo</label>
            <select id="f-risk" className="input" value={risk} onChange={(e) => { setRisk(e.target.value as RiskLevel | ''); resetScroll(); }}>
              <option value="">Todos</option>
              {(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((r) => (<option key={r} value={r}>{RISK_LABELS_ES[r]}</option>))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-type">Tipo de anomalía</label>
            <select id="f-type" className="input" value={type} onChange={(e) => { setType(e.target.value as AnomalyType | ''); resetScroll(); }}>
              <option value="">Todos</option>
              {presentTypes.map((t) => (<option key={t} value={t}>{TYPE_LABELS_ES[t]}</option>))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-sort">Ordenar por</label>
            <select id="f-sort" className="input" value={sort} onChange={(e) => { setSort(e.target.value as SortKey); resetScroll(); }}>
              <option value="score">Puntaje (mayor primero)</option>
              <option value="risk">Nivel de riesgo</option>
              <option value="record">Número de registro</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-q">Buscar</label>
            <input id="f-q" className="input" type="search" placeholder="campo, texto o id…" value={query} onChange={(e) => { setQuery(e.target.value); resetScroll(); }} />
          </div>
        </div>
        <span className="small muted" aria-live="polite">{fmtInt(rows.length)} de {fmtInt(findings.length)} hallazgos</span>
      </div>

      <div className="vt-outer">
        <div className="vt-scroll" role="table" aria-rowcount={rows.length + 1} aria-label="Hallazgos">
          <div className="vt-head" role="row">
            <div role="columnheader">Registro</div>
            <div role="columnheader">Tipo de anomalía</div>
            <div role="columnheader">Nivel de riesgo</div>
            <div role="columnheader">Campo afectado</div>
            <div role="columnheader">Explicación</div>
          </div>
          <div ref={body} className="vt-body" data-testid="vt-body" onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} style={{ height }}>
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {visible.map((f, i) => {
                const idx = start + i;
                return (
                  <div
                    key={`${f.recordIndex}-${f.type}-${f.field}-${idx}`}
                    className="vt-row"
                    role="row"
                    aria-rowindex={idx + 2}
                    aria-selected={selected === f}
                    tabIndex={0}
                    style={{ top: idx * ROW_H }}
                    onClick={() => onOpen?.(f)}
                    onKeyDown={(e) => onKey(e, f)}
                  >
                    <div role="cell" className="mono">{recordLabel(f)}</div>
                    <div role="cell">{TYPE_LABELS_ES[f.type]}</div>
                    <div role="cell"><RiskChip risk={f.risk} /></div>
                    <div role="cell" className="mono">{f.field ?? '—'}</div>
                    <div role="cell" className="expl" title={f.explanation}>{f.explanation}</div>
                  </div>
                );
              })}
            </div>
            {rows.length === 0 && <p className="muted" style={{ padding: 20 }}>No hay hallazgos con esos filtros.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
