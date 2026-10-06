'use client';

import type { ProcessingMode } from '@/engine';

const MODES: Array<{ mode: ProcessingMode; title: string; text: string }> = [
  { mode: 'main', title: 'Hilo principal', text: 'Todo en la interfaz. Rápido de programar, pero la página se congela con archivos grandes.' },
  { mode: 'worker', title: '1 Web Worker', text: 'Un hilo aparte: la interfaz sigue fluida, pero solo se usa un núcleo.' },
  { mode: 'pool', title: 'Workers en paralelo', text: 'El archivo se parte en bloques y varios workers trabajan a la vez.' },
];

export function ModeSelector({ mode, onMode, workers, onWorkers, maxWorkers, disabled }: {
  mode: ProcessingMode;
  onMode: (m: ProcessingMode) => void;
  workers: number;
  onWorkers: (n: number) => void;
  maxWorkers: number;
  disabled?: boolean;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={disabled}>
      <legend className="small muted" style={{ fontWeight: 600, marginBottom: 8 }}>Modo de procesamiento</legend>
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
