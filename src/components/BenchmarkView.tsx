'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_OPTIONS, generateDataset, type ProcessingMode, type SynthKind } from '@/engine';
import { FrameMonitor, type FrameStats } from '@/lib/frameMonitor';
import { fmtBytes, fmtInt, fmtMs } from '@/lib/format';
import { defaultWorkerCount, runAnalysis } from '@/lib/runner';
import { LiveMeter } from './LiveMeter';
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
  const [cores, setCores] = useState(0);
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
    setCores(navigator.hardwareConcurrency || 0);
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
      if (!skipMain) plan.push({ key: 'main', label: 'Hilo principal', mode: 'main', workers: 1, color: 'var(--critical)' });
      plan.push({ key: 'worker', label: '1 Web Worker', mode: 'worker', workers: 1, color: 'var(--medium)' });
      plan.push({ key: 'pool', label: `${workers} Workers`, mode: 'pool', workers, color: 'var(--accent)' });

      const out: Result[] = [];
      for (const p of plan) {
        if (controller.signal.aborted) break;
        setStatus(`Midiendo: ${p.label}…`);
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

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Diferencial</p>
        <h1 style={{ fontSize: '2rem' }}>Hilo principal vs Web Workers</h1>
        <p className="muted" style={{ maxWidth: 740 }}>
          Se analiza <b>el mismo archivo</b> tres veces: todo en el hilo de la interfaz, con un worker y con varios workers en paralelo. Se mide el tiempo total
          y qué tan congelada queda la página (pausa más larga entre cuadros). El resultado del análisis debe ser idéntico en los tres.
        </p>
      </header>

      <section className="card stack">
        <div className="row">
          <div className="field">
            <label htmlFor="b-kind">Datos</label>
            <select id="b-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as SynthKind)} disabled={running}>
              {KINDS.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-rows">Registros</label>
            <select id="b-rows" className="input" value={rows} onChange={(e) => setRows(Number(e.target.value))} disabled={running}>
              {SIZES.map((n) => (<option key={n} value={n}>{fmtInt(n)}</option>))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-w">Workers en paralelo</label>
            <input id="b-w" className="input" type="number" min={2} max={16} value={workers} onChange={(e) => setWorkers(Math.max(2, Math.min(16, Number(e.target.value) || 2)))} style={{ width: 90 }} disabled={running} />
          </div>
          <label className="small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={skipMain} onChange={(e) => setSkipMain(e.target.checked)} disabled={running} /> omitir hilo principal (para archivos enormes)
          </label>
          <button className="btn primary" style={{ alignSelf: 'end' }} onClick={() => void run()} disabled={running} data-testid="bench-run">{running ? 'Midiendo…' : 'Ejecutar benchmark'}</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Tu equipo reporta {cores || '?'} núcleos lógicos. Con el hilo principal la página <b>se congelará</b> mientras dure su medición; es lo que se quiere demostrar.
          {rows >= 500_000 && ' Con ≥ 500 000 registros puede tardar bastante.'}
        </p>
        {status && <p className="small" role="status" style={{ margin: 0 }}>{status}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
      </section>

      {(running || results.length > 0) && (
        <section className="card" aria-label="Medidor en vivo">
          <h3>Fluidez de la interfaz</h3>
          <LiveMeter monitor={monitor} active={running} stats={final} />
        </section>
      )}

      {results.length > 0 && (
        <section className="card stack" aria-label="Resultados">
          <h2>Resultados {size > 0 && <span className="muted small">· {fmtInt(rows)} registros · {fmtBytes(size)}</span>}</h2>
          <div>
            <h3>Tiempo total</h3>
            {results.map((r) => (
              <div className="bench-bar" key={r.key}>
                <span>{r.label}</span>
                <span className="track"><i style={{ width: `${(r.ms / maxMs) * 100}%`, background: r.color }} /></span>
                <b className="mono">{fmtMs(r.ms)}</b>
              </div>
            ))}
          </div>
          <div>
            <h3>Pausa más larga de la interfaz <span className="muted small">(menos es mejor; &gt;100 ms se siente trabado)</span></h3>
            {results.map((r) => (
              <div className="bench-bar" key={r.key}>
                <span>{r.label}</span>
                <span className="track"><i style={{ width: `${(r.frames.maxGapMs / maxGap) * 100}%`, background: r.color }} /></span>
                <b className="mono">{fmtMs(r.frames.maxGapMs)}</b>
              </div>
            ))}
          </div>
          <div className="table-scroll">
            <table className="plain">
              <thead><tr><th>Modo</th><th>Tiempo</th><th>Pausa más larga</th><th>Congelamientos</th><th>Tiempo congelado</th><th>FPS</th><th>Hallazgos</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
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
          <p style={{ margin: 0 }}>
            {main && pool ? (
              <>Con {pool.workers} workers el análisis fue <b>{fmtNum(main.ms / pool.ms, 1)}×</b> {main.ms >= pool.ms ? 'más rápido' : 'el tiempo'} que en el hilo principal y la pausa más larga bajó de <b>{fmtMs(main.frames.maxGapMs)}</b> a <b>{fmtMs(pool.frames.maxGapMs)}</b>. </>
            ) : null}
            {identical ? '✓ Los tres modos produjeron exactamente los mismos hallazgos.' : results.length > 1 ? '⚠ Los modos no produjeron los mismos hallazgos: es un error, repórtalo.' : null}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Nota: la ganancia de velocidad depende de los núcleos reales de tu equipo y del tamaño del archivo; la mejora en fluidez aparece siempre que se usa cualquier worker.
          </p>
        </section>
      )}
    </div>
  );
}
