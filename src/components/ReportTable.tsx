'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { RISK_LABELS_ES, TYPE_LABELS_ES, type AnomalyType, type Finding, type RiskLevel } from '@/engine';
import { recordLabel } from '@/engine/exporters';
import { Icon } from './Icon';
import { RiskChip } from './Summary';
import { fmtInt } from '@/lib/format';

/** Row height of the hand-made virtual list: one line of table on desktop, a stacked card on phones. */
const ROW_H_TABLE = 60;
const ROW_H_CARD = 164;
const CARD_QUERY = '(max-width: 720px)';
const OVERSCAN = 8;
const RISK_RANK: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };
type SortKey = 'score' | 'record' | 'risk';

/** Lets the page point the table at a group of findings ("Ver los casos"). `nonce` makes repeated clicks work. */
export interface TableFocus {
  type?: AnomalyType;
  urgentFirst?: boolean;
  nonce: number;
}

/**
 * Report table: Registro · Tipo de anomalía · Nivel de riesgo · Campo afectado · Explicación.
 * Virtualised by hand (only ~20 rows exist in the DOM) so 200 000 findings scroll at 60 fps without any dependency.
 */
export function ReportTable({ findings, onOpen, selected, focus, actions, title = 'Hallazgos' }: {
  findings: Finding[];
  onOpen?: (f: Finding) => void;
  selected?: Finding | null;
  focus?: TableFocus | null;
  /** Extra buttons shown in the toolbar (download, save…). */
  actions?: ReactNode;
  title?: string;
}) {
  const [risk, setRisk] = useState<RiskLevel | ''>('');
  const [type, setType] = useState<AnomalyType | ''>('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('score');
  const [scrollTop, setScrollTop] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const deferredQuery = useDeferredValue(query);
  const [cards, setCards] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(CARD_QUERY);
    const sync = (): void => setCards(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const ROW_H = cards ? ROW_H_CARD : ROW_H_TABLE;

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
  useEffect(() => {
    if (!focus) return;
    setType(focus.type ?? '');
    setRisk('');
    setQuery('');
    setSort(focus.urgentFirst ? 'risk' : 'score');
    setScrollTop(0);
    if (body.current) body.current.scrollTop = 0;
    section.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  const onKey = (e: KeyboardEvent, f: Finding): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.(f);
    }
  };

  return (
    <section ref={section} className="report-section" aria-label="Reporte de hallazgos">
      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Icon name="search" size={16} />
          <label htmlFor="f-q" className="sr-only">Buscar</label>
          <input id="f-q" className="input" type="search" placeholder="Buscar por campo, valor o número de registro…" value={query} onChange={(e) => { setQuery(e.target.value); resetScroll(); }} />
        </div>
        <div className="toolbar-filters">
          <label className="select-label">
            <span>Riesgo</span>
            <select id="f-risk" className="input" value={risk} onChange={(e) => { setRisk(e.target.value as RiskLevel | ''); resetScroll(); }}>
              <option value="">Todos</option>
              {(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((r) => (<option key={r} value={r}>{RISK_LABELS_ES[r]}</option>))}
            </select>
          </label>
          <label className="select-label">
            <span>Tipo de problema</span>
            <select id="f-type" className="input" value={type} onChange={(e) => { setType(e.target.value as AnomalyType | ''); resetScroll(); }}>
              <option value="">Todos</option>
              {presentTypes.map((tp) => (<option key={tp} value={tp}>{TYPE_LABELS_ES[tp]}</option>))}
            </select>
          </label>
          <label className="select-label">
            <span>Ordenar por</span>
            <select id="f-sort" className="input" value={sort} onChange={(e) => { setSort(e.target.value as SortKey); resetScroll(); }}>
              <option value="score">Más importantes primero</option>
              <option value="risk">Más urgentes primero</option>
              <option value="record">En orden del archivo</option>
            </select>
          </label>
        </div>
        {actions && <div className="toolbar-actions">{actions}</div>}
      </div>

      <div className="card table-card">
        <div className="table-card-head">
          <h3 className="card-title">{title} <span className="tag">{fmtInt(findings.length)}</span></h3>
          <span className="small muted" aria-live="polite">Mostrando {fmtInt(rows.length)} de {fmtInt(findings.length)}</span>
        </div>
        <div className="vt-outer">
          <div className={`vt-scroll${cards ? ' cards' : ''}`} role="table" aria-rowcount={rows.length + 1} aria-label="Hallazgos">
            <div className="vt-head" role="row">
              <div role="columnheader">Registro</div>
              <div role="columnheader">Tipo de anomalía</div>
              <div role="columnheader">Nivel de riesgo</div>
              <div role="columnheader">Campo afectado</div>
              <div role="columnheader">Explicación</div>
              <div role="columnheader"><span className="sr-only">Abrir</span></div>
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
                      style={{ top: idx * ROW_H, height: ROW_H }}
                      onClick={() => onOpen?.(f)}
                      onKeyDown={(e) => onKey(e, f)}
                    >
                      <div role="cell" className="mono c-record">{recordLabel(f)}</div>
                      <div role="cell" className="c-type">{TYPE_LABELS_ES[f.type]}</div>
                      <div role="cell" className="c-risk"><RiskChip risk={f.risk} /></div>
                      <div role="cell" className="mono c-field">{f.field ?? '—'}</div>
                      <div role="cell" className="expl" title={f.explanation}>{f.explanation}</div>
                      <div role="cell" className="c-go"><Icon name="chevronRight" size={16} /></div>
                    </div>
                  );
                })}
              </div>
              {rows.length === 0 && <p className="muted" style={{ padding: 20 }}>No hay hallazgos con esos filtros.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
