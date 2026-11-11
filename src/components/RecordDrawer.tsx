'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TYPE_LABELS_ES, type Finding } from '@/engine';
import { recordLabel } from '@/engine/exporters';
import { RiskChip } from './Summary';

export interface RecordData {
  header: string[];
  values: string[];
}

/** Side panel with the original row (when the analysis is still in memory) and every finding for that record. */
export function RecordDrawer({ finding, findings, loadRecord, onClose }: {
  finding: Finding;
  findings: Finding[];
  loadRecord?: (recordIndex: number) => Promise<RecordData>;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idx = finding.recordIndex;

  useEffect(() => {
    setRecord(null);
    setError(null);
    if (idx === null || !loadRecord) return;
    let cancelled = false;
    loadRecord(idx).then(
      (r) => !cancelled && setRecord(r),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [idx, loadRecord]);

  const panel = useRef<HTMLElement>(null);
  // modal dialog: Escape closes, Tab/Shift+Tab stay inside, focus returns to the element that opened it
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const focusables = panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  const same = useMemo(() => (idx === null ? [finding] : findings.filter((f) => f.recordIndex === idx)), [findings, idx, finding]);
  const affected = new Set(same.map((f) => f.field).filter(Boolean));

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-label={`Detalle del ${recordLabel(finding)}`}>
        <div className="row spread">
          <h2 style={{ margin: 0 }}>{recordLabel(finding)}</h2>
          <button className="btn sm" onClick={onClose} autoFocus>Cerrar</button>
        </div>
        <h3 style={{ marginTop: 18 }}>Hallazgos de este registro ({same.length})</h3>
        <div className="stack">
          {same.map((f, i) => (
            <div key={i} className="card flat" style={{ padding: 12 }}>
              <div className="row spread">
                <b>{TYPE_LABELS_ES[f.type]}</b>
                <RiskChip risk={f.risk} />
              </div>
              <p className="small" style={{ margin: '6px 0 0' }}>{f.explanation}</p>
              <p className="small muted mono" style={{ margin: '4px 0 0' }}>campo: {f.field ?? '—'} · puntaje {Math.round(f.score)} · {f.detector}</p>
            </div>
          ))}
        </div>
        {idx !== null && (
          <>
            <h3 style={{ marginTop: 22 }}>Registro original</h3>
            {!loadRecord && <p className="small muted">El archivo original no se guarda; el detalle solo está disponible mientras el análisis sigue abierto en este navegador.</p>}
            {loadRecord && !record && !error && <div className="skeleton" style={{ height: 120 }} aria-label="Cargando registro" role="status" />}
            {error && <p className="alert error small" role="alert">{error}</p>}
            {record && (
              <table className="kvtable" aria-label="Valores del registro original; los campos con hallazgos están resaltados">
                <tbody>
                  {record.header.map((h, i) => (
                    <tr key={i} className={affected.has(h) ? 'hl' : undefined}>
                      <th scope="row" style={{ fontWeight: affected.has(h) ? 700 : 500, textAlign: 'left' }}>{h}{affected.has(h) && <span className="sr-only"> (con hallazgos)</span>}</th>
                      <td>{record.values[i] === '' ? <span className="muted">(vacío)</span> : record.values[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </aside>
    </>
  );
}
