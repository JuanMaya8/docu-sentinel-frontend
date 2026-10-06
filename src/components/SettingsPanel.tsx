'use client';

import type { AnalysisOptions, DetectorId, MlMode, Sensitivity } from '@/engine';
import type { BaselineDto } from '@/lib/api';

export interface UiSettings {
  sensitivity: Sensitivity;
  mlMode: MlMode;
  baselineId: string;
  dateOrder: AnalysisOptions['dateOrder'];
  detectors: Record<DetectorId, boolean>;
  keyColumns: string;
}

const DETECTOR_LABELS: Record<DetectorId, string> = {
  duplicates: 'Duplicados',
  missing: 'Campos faltantes',
  types: 'Tipos y formatos',
  range: 'Rangos',
  relations: 'Relaciones',
  suspicious: 'Sospechosos',
  ml: 'IA (multivariante)',
};

export function SettingsPanel({ value, onChange, baselines, baselinesError, disabled }: {
  value: UiSettings;
  onChange: (v: UiSettings) => void;
  baselines: BaselineDto[];
  baselinesError?: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof UiSettings>(k: K, v: UiSettings[K]): void => onChange({ ...value, [k]: v });
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={disabled}>
      <div className="grid cols-3">
        <div className="field">
          <label htmlFor="sens">Sensibilidad</label>
          <select id="sens" className="input" value={value.sensitivity} onChange={(e) => set('sensitivity', e.target.value as Sensitivity)}>
            <option value="low">Baja (menos alertas)</option>
            <option value="medium">Media</option>
            <option value="high">Alta (más alertas)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ml">Inteligencia artificial</label>
          <select id="ml" className="input" value={value.mlMode} onChange={(e) => set('mlMode', e.target.value as MlMode)}>
            <option value="local">Aprender de este archivo</option>
            <option value="baseline">Aprender de datos históricos (línea base)</option>
            <option value="off">Solo reglas, sin IA</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="dord">Orden de fechas ambiguas</label>
          <select id="dord" className="input" value={value.dateOrder} onChange={(e) => set('dateOrder', e.target.value as UiSettings['dateOrder'])}>
            <option value="dmy">Día/Mes/Año</option>
            <option value="mdy">Mes/Día/Año</option>
          </select>
        </div>
      </div>

      {value.mlMode === 'baseline' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="bl">Línea base histórica</label>
          <select id="bl" className="input" value={value.baselineId} onChange={(e) => set('baselineId', e.target.value)}>
            <option value="">— elige una —</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>{b.name} · {b.rows.toLocaleString('es-CO')} filas</option>
            ))}
          </select>
          {baselinesError && <span className="small" style={{ color: 'var(--critical)' }}>{baselinesError}</span>}
          {!baselinesError && baselines.length === 0 && <span className="small muted">Aún no tienes líneas base. Analiza un archivo histórico y usa «Guardar como línea base».</span>}
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Avanzado: detectores y columna clave</summary>
        <div className="row" style={{ margin: '10px 0' }}>
          {(Object.keys(DETECTOR_LABELS) as DetectorId[]).map((d) => (
            <label key={d} className="chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={value.detectors[d]} onChange={(e) => set('detectors', { ...value.detectors, [d]: e.target.checked })} />
              {DETECTOR_LABELS[d]}
            </label>
          ))}
        </div>
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="keys">Columna(s) clave para duplicados (opcional, separadas por coma)</label>
          <input id="keys" className="input" placeholder="se detecta sola, p. ej. invoice_number" value={value.keyColumns} onChange={(e) => set('keyColumns', e.target.value)} />
        </div>
      </details>
    </fieldset>
  );
}
