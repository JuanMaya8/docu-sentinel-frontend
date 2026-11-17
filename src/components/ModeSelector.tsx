'use client';

import type { ProcessingMode } from '@/engine';

const MODES: Array<{ mode: ProcessingMode; title: string; text: string }> = [
  { mode: 'pool', title: 'Rápido (recomendado)', text: 'Divide el archivo en partes y las revisa al mismo tiempo. La página sigue respondiendo.' },
  { mode: 'worker', title: 'En segundo plano', text: 'Revisa el archivo de principio a fin mientras puedes seguir usando la página.' },
  { mode: 'main', title: 'Básico', text: 'Revisa todo de una vez. Con archivos grandes la página puede quedarse quieta unos segundos.' },
];

export function ModeSelector({ mode, onMode, disabled }: {
  mode: ProcessingMode;
  onMode: (m: ProcessingMode) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, minWidth: 0 }} disabled={disabled}>
      <legend className="field-title">Velocidad del análisis</legend>
      <div className="grid cols-3">
        {MODES.map((m) => (
          <button key={m.mode} type="button" className="mode-card" aria-pressed={mode === m.mode} onClick={() => onMode(m.mode)}>
            <b>{m.title}</b>
            <span className="muted small">{m.text}</span>
          </button>
        ))}
      </div>
      {mode === 'pool' && (
        <div className="row" style={{ marginTop: 12 }}>
          <label className="small muted" htmlFor="workers">Workers en paralelo</label>
          <input id="workers" className="input" type="number" min={2} max={maxWorkers} value={workers} onChange={(e) => onWorkers(Math.max(2, Math.min(maxWorkers, Number(e.target.value) || 2)))} style={{ width: 72 }} />
          <span className="small muted">tu equipo reporta {maxWorkers + 1} núcleos lógicos</span>
        </div>
      )}
    </fieldset>
  );
}
