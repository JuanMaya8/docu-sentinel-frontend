'use client';

import { useState } from 'react';
import type { TrainingSample } from '@/engine';
import { api, errorMessage, type BaselineDto } from '@/lib/api';
import { fmtInt } from '@/lib/format';

const MAX_TRAIN_ROWS = 100_000;

function toMatrix(s: TrainingSample): Array<Array<number | null>> {
  const F = s.columns.length;
  const rows = Math.min(s.rows, MAX_TRAIN_ROWS);
  const out: Array<Array<number | null>> = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row: Array<number | null> = new Array(F);
    for (let c = 0; c < F; c++) {
      const v = s.matrix[r * F + c];
      row[c] = Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null; // JSON has no NaN
    }
    out[r] = row;
  }
  return out;
}

/** "Learn from history": send ONLY the numeric feature sample (no original text) to train a baseline in the AI service. */
export function BaselinePanel({ training, defaultName, baselines, onChanged }: {
  training?: TrainingSample;
  defaultName: string;
  baselines: BaselineDto[];
  onChanged: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const train = async (): Promise<void> => {
    if (!training) return;
    setBusy(true);
    setMsg(null);
    try {
      const b = await api.createBaseline({
        name: name.trim() || defaultName,
        columns: training.columns,
        kinds: training.kinds,
        matrix: toMatrix(training),
        schemaSignature: training.schemaSignature,
        contamination: training.contamination,
        thresholdFloor: training.thresholdFloor,
      });
      setMsg({ kind: 'ok', text: `Línea base «${b.name}» entrenada con ${fmtInt(b.rows)} filas. Ya puedes elegirla en «Inteligencia artificial».` });
      onChanged();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const retrain = async (b: BaselineDto): Promise<void> => {
    if (!training) return;
    if (!window.confirm(`¿Reentrenar «${b.name}» con los datos de este archivo? El modelo anterior se reemplaza.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.retrainBaseline(b.id, {
        matrix: toMatrix(training),
        columns: training.columns,
        contamination: training.contamination,
        thresholdFloor: training.thresholdFloor,
      });
      setMsg({ kind: 'ok', text: `Línea base «${r.name}» reentrenada (versión ${r.version ?? '?'}, ${fmtInt(r.rows)} filas).` });
      onChanged();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const compatible = (b: BaselineDto): boolean =>
    !!training && b.columns.length === training.columns.length && b.columns.every((c, i) => c === training.columns[i]);

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteBaseline(id);
      onChanged();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  };

  return (
    <section className="card stack" aria-labelledby="bl-title">
      <div>
        <h3 id="bl-title">Aprender de datos históricos</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Guarda este archivo como <b>línea base</b>: el modelo aprende qué es «normal» en tu operación y, en próximos archivos, marca lo que se aleja de ese histórico.
          Solo se envían números derivados (sin los textos originales).
        </p>
      </div>
      {training ? (
        <div className="row">
          <input className="input" aria-label="Nombre de la línea base" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 240 }} />
          <button className="btn primary" onClick={train} disabled={busy}>{busy ? 'Entrenando…' : 'Guardar como línea base'}</button>
          <span className="small muted">{fmtInt(Math.min(training.rows, MAX_TRAIN_ROWS))} filas · {training.columns.length} características</span>
        </div>
      ) : (
        <p className="small muted">Este análisis no generó muestra de entrenamiento (la IA estaba desactivada o el archivo tiene muy pocas columnas numéricas).</p>
      )}
      {msg && <p className={`alert small ${msg.kind === 'error' ? 'error' : ''}`} role="status">{msg.text}</p>}
      {baselines.length > 0 && (
        <div className="table-scroll">
          <table className="plain">
            <thead><tr><th>Línea base</th><th>Versión</th><th>Filas</th><th>Umbral</th><th>Piso</th><th /></tr></thead>
            <tbody>
              {baselines.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="mono">v{b.version ?? 1}</td>
                  <td className="mono">{fmtInt(b.rows)}</td>
                  <td className="mono">{b.threshold.toFixed(3)}</td>
                  <td className="mono">{b.thresholdFloor !== undefined ? b.thresholdFloor.toFixed(2) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {compatible(b) && (
                      <button className="btn sm" onClick={() => void retrain(b)} disabled={busy} title="Mismas columnas que este archivo">
                        Reentrenar con este archivo
                      </button>
                    )}{' '}
                    <button className="btn sm danger" onClick={() => remove(b.id)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
