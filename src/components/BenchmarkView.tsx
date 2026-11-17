'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_OPTIONS, generateDataset, type ProcessingMode, type SynthKind } from '@/engine';
import { FrameMonitor, type FrameStats } from '@/lib/frameMonitor';
import { fmtBytes, fmtInt, fmtMs } from '@/lib/format';
import { defaultWorkerCount, runAnalysis } from '@/lib/runner';
import { Icon } from './Icon';
import { LiveMeter } from './LiveMeter';
import { MODE_LABEL } from '@/lib/modes';
import { fmtNum } from '@/engine';

interface Result {
  key: string;
  label: string;
  mode: ProcessingMode;
  workers: number;
  ms: number;
  frames: FrameStats;
  findings: number;
  signature: string;
  color: string;
}

const SIZES = [50_000, 200_000, 500_000, 1_000_000];
const KINDS: Array<[SynthKind, string]> = [['invoices', 'Facturas (CSV)'], ['orders', 'Pedidos (CSV)'], ['inventory', 'Inventario (JSON)']];

export default function BenchmarkView() {
  const [kind, setKind] = useState<SynthKind>('invoices');
  const [rows, setRows] = useState(200_000);
  const [workers, setWorkers] = useState(4);
  const [skipMain, setSkipMain] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const monitor = useMemo(() => new FrameMonitor(), []);
  const [final, setFinal] = useState<FrameStats | undefined>();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setWorkers(defaultWorkerCount());
    return () => {
      abort.current?.abort();
      monitor.stop();
    };
  }, [monitor]);

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setResults([]);
    setFinal(undefined);
    const controller = new AbortController();
    abort.current = controller;
    try {
      setStatus(`Generando ${fmtInt(rows)} registros de ejemplo…`);
      await new Promise((r) => setTimeout(r, 60));
      const data = generateDataset({ kind, rows, seed: 11 });
      setSize(data.blob.size);
      const plan: Array<{ key: string; label: string; mode: ProcessingMode; workers: number; color: string }> = [];
      if (!skipMain) plan.push({ key: 'main', label: MODE_LABEL.main, mode: 'main', workers: 1, color: 'var(--critical)' });
      plan.push({ key: 'worker', label: MODE_LABEL.worker, mode: 'worker', workers: 1, color: 'var(--medium)' });
      plan.push({ key: 'pool', label: MODE_LABEL.pool, mode: 'pool', workers, color: 'var(--accent)' });

      const out: Result[] = [];
      for (const p of plan) {
        if (controller.signal.aborted) break;
        setStatus(`Midiendo el modo ${p.label}…`);
        await new Promise((r) => setTimeout(r, 400)); // let the page settle between runs
        monitor.start();
        const t0 = performance.now();
        const { session } = await runAnalysis({
          file: data.blob,
          fileName: data.fileName,
          mode: p.mode,
          workers: p.workers,
          options: { ml: { ...DEFAULT_OPTIONS.ml, mode: 'local' } },
          signal: controller.signal,
        });
        const ms = performance.now() - t0;
        const frames = monitor.stop();
        const r = session.report;
        out.push({
          ...p,
          ms,
          frames,
          findings: r.totalFindings,
          signature: JSON.stringify([r.totalFindings, r.recordsAffected, r.byRisk, r.byType]),
        });
        session.dispose();
        setFinal(frames);
        setResults([...out]);
      }
      setStatus('Listo.');
    } catch (e) {
      monitor.stop();
      setError(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setRunning(false);
    }
  };

  const maxMs = Math.max(1, ...results.map((r) => r.ms));
  const maxGap = Math.max(1, ...results.map((r) => r.frames.maxGapMs));
  const main = results.find((r) => r.mode === 'main');
  const pool = results.find((r) => r.mode === 'pool');
  const identical = results.length > 1 && results.every((r) => r.signature === results[0].signature);

  /** "3,2× más rápido que Básico" — only from measured times. */
  const versusBasic = (r: Result): string | null => {
    if (!main || r === main || r.ms <= 0 || main.ms <= 0) return null;
    if (Math.abs(main.ms / r.ms - 1) < 0.08) return 'tiempo similar a Básico';
    return main.ms >= r.ms ? `${fmtNum(main.ms / r.ms, 1)}× más rápido que Básico` : `${fmtNum(r.ms / main.ms, 1)}× más lento que Básico`;
  };

  return (
    <div className="stack bench">
      <header className="page-head">
        <div>
          <p className="eyebrow">Prueba de rendimiento</p>
          <h1>¿Cuánto cambia la velocidad?</h1>
          <p>
            Analizamos <b>el mismo archivo</b> con las tres velocidades (<b>Básico</b>, <b>En segundo plano</b> y <b>Rápido</b>) y medimos cuánto tarda
            cada una y si la página se traba mientras trabaja. Los hallazgos deben ser exactamente los mismos en las tres.
          </p>
        </div>
      </header>

      <section className="card bench-controls" aria-label="Configurar la prueba">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="select-label">
            <span>Datos</span>
            <select id="b-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as SynthKind)} disabled={running}>
              {KINDS.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </select>
          </label>
          <label className="select-label">
            <span>Registros</span>
            <select id="b-rows" className="input" value={rows} onChange={(e) => setRows(Number(e.target.value))} disabled={running}>
              {SIZES.map((n) => (<option key={n} value={n}>{fmtInt(n)}</option>))}
            </select>
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={skipMain} onChange={(e) => setSkipMain(e.target.checked)} disabled={running} /> Omitir el modo Básico (archivos muy grandes)
          </label>
          <button className="btn primary bench-run" onClick={() => void run()} disabled={running} data-testid="bench-run">
            <Icon name="play" size={14} /> {running ? 'Midiendo…' : 'Comparar'}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Mientras se mide el modo <b>Básico</b> la página se quedará quieta unos segundos: es justo la diferencia que se quiere mostrar.
          {rows >= 500_000 && ' Con 500.000 registros o más puede tardar bastante.'}
        </p>
        {status && <p className="small" role="status" style={{ margin: 0 }}>{status}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
      </section>

      {(running || results.length > 0) && (
        <div className="bench-grid">
          <section className="card" aria-label="Tiempos medidos">
            <div className="card-head">
              <h2 className="card-title">Tiempo total {size > 0 && <span className="muted small">· {fmtInt(rows)} registros · {fmtBytes(size)}</span>}</h2>
            </div>
            {results.length === 0 && <p className="small muted" style={{ margin: 0 }}>Midiendo la primera velocidad…</p>}
            {results.map((r) => (
              <div className="bench-bar" key={r.key}>
                <span className="bench-label">
                  <b>{r.label}</b>
                  {versusBasic(r) && <span className="small" style={{ color: 'var(--accent-text)' }}>{versusBasic(r)}</span>}
                </span>
                <span className="track"><i style={{ width: `${(r.ms / maxMs) * 100}%`, background: r.color }} /></span>
                <b className="mono">{fmtMs(r.ms)}</b>
              </div>
            ))}
            {results.length > 0 && (
              <>
                <h3 className="drawer-sub">Pausa más larga de la página <span style={{ textTransform: 'none', letterSpacing: 0 }}>(menos es mejor; más de 100 ms ya se siente trabada)</span></h3>
                {results.map((r) => (
                  <div className="bench-bar" key={r.key}>
                    <span className="bench-label"><b>{r.label}</b></span>
                    <span className="track"><i style={{ width: `${(r.frames.maxGapMs / maxGap) * 100}%`, background: r.color }} /></span>
                    <b className="mono" style={{ color: r.frames.maxGapMs > 100 ? 'var(--critical-text)' : undefined }}>{fmtMs(r.frames.maxGapMs)}</b>
                  </div>
                ))}
              </>
            )}
          </section>

          <section className="card bench-live" aria-label="Medidor en vivo">
            <div className="card-head">
              <h2 className="card-title">Fluidez de la página</h2>
              {running && <span className="chip ok"><span className="dot" aria-hidden="true" /> En vivo</span>}
            </div>
            <LiveMeter monitor={monitor} active={running} stats={final} />
            <p className="small muted" style={{ margin: 0 }}>El punto gira en cada cuadro que dibuja la página. Si se detiene, la página está trabada.</p>
          </section>
        </div>
      )}

      {results.length > 0 && (
        <>
          <section className="card table-card" aria-label="Resultados detallados">
            <div className="table-card-head">
              <h2 className="card-title">Resultados detallados</h2>
              <span className="small muted">{fmtInt(rows)} registros · {fmtBytes(size)}</span>
            </div>
            <div className="table-scroll">
              <table className="plain">
                <thead><tr><th>Velocidad</th><th>Tiempo</th><th>Pausa más larga</th><th>Trabas</th><th>Tiempo trabado</th><th>Fluidez (cuadros/s)</th><th>Hallazgos</th></tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.key}>
                      <td><span className="row" style={{ gap: 8 }}><span className="dot" style={{ color: r.color }} aria-hidden="true" /> {r.label}</span></td>
                      <td className="mono">{fmtMs(r.ms)}</td>
                      <td className="mono">{fmtMs(r.frames.maxGapMs)}</td>
                      <td className="mono">{r.frames.freezes}</td>
                      <td className="mono">{fmtMs(r.frames.frozenMs)}</td>
                      <td className="mono">{Math.round(r.frames.fps)}</td>
                      <td className="mono">{fmtInt(r.findings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card conclusion" aria-label="Conclusión">
            <span className="icon-tile"><Icon name="gauge" /></span>
            <div>
              <h2 className="card-title">Conclusión</h2>
              <p style={{ margin: '6px 0 0' }}>
                {main && pool ? (
                  <>El modo Rápido tardó <b>{fmtNum(main.ms / pool.ms, 1)}×</b> {main.ms >= pool.ms ? 'menos' : 'lo mismo'} que el Básico y la pausa más larga de la página bajó de <b>{fmtMs(main.frames.maxGapMs)}</b> a <b>{fmtMs(pool.frames.maxGapMs)}</b>. </>
                ) : null}
                {identical ? '✓ Las tres velocidades encontraron exactamente los mismos hallazgos.' : results.length > 1 ? '⚠ Las velocidades no encontraron los mismos hallazgos: es un error, repórtalo.' : null}
              </p>
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                Cuánto más rápido resulta depende de la potencia de tu equipo y del tamaño del archivo; en los modos En segundo plano y Rápido la página nunca se traba.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
