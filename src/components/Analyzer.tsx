'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnalysisAborted,
  DEFAULT_OPTIONS,
  findingsToCsv,
  findingsToJson,
  generateDataset,
  type AnalysisOptions,
  type AnalysisSession,
  type BaselineRef,
  type Finding,
  type ProcessingMode,
  type Progress,
  type SynthKind,
  type TrainingSample,
} from '@/engine';
import { api, errorMessage, isAuthError, type BaselineDto } from '@/lib/api';
import { clearLastAnalysis, loadLastAnalysis, saveLastAnalysis, type StoredAnalysis } from '@/lib/lastAnalysis';
import { FrameMonitor, type FrameStats } from '@/lib/frameMonitor';
import { downloadText, fmtBytes, fmtInt, fmtMs } from '@/lib/format';
import { defaultWorkerCount, runAnalysis } from '@/lib/runner';
import { BaselinePanel } from './BaselinePanel';
import { Dropzone } from './Dropzone';
import { LiveMeter } from './LiveMeter';
import { ModeSelector } from './ModeSelector';
import { RecordDrawer } from './RecordDrawer';
import { ReportTable } from './ReportTable';
import { SettingsPanel, type UiSettings } from './SettingsPanel';
import { Summary } from './Summary';

const MODE_LABEL: Record<ProcessingMode, string> = { main: 'Hilo principal', worker: '1 worker', pool: 'Workers en paralelo' };
const SAMPLE_KINDS: Array<[SynthKind, string]> = [['invoices', 'Facturas (CSV)'], ['inventory', 'Inventario (JSON)'], ['orders', 'Pedidos (CSV)']];
const SAMPLE_SIZES = [10_000, 50_000, 200_000, 500_000];
const MAX_SAVED_FINDINGS = 100_000;

interface RunRow {
  id: number;
  file: string;
  rows: number;
  mode: ProcessingMode;
  workers: number;
  ms: number;
  frames: FrameStats;
}

type Phase = 'idle' | 'generating' | 'running' | 'done' | 'error';

export default function Analyzer() {
  const [mode, setMode] = useState<ProcessingMode>('pool');
  const [workers, setWorkers] = useState(4);
  const [maxWorkers, setMaxWorkers] = useState(7);
  const [settings, setSettings] = useState<UiSettings>({
    sensitivity: 'medium',
    mlMode: 'local',
    baselineId: '',
    dateOrder: 'dmy',
    detectors: { ...DEFAULT_OPTIONS.detectors },
    keyColumns: '',
  });
  const [baselines, setBaselines] = useState<BaselineDto[]>([]);
  const [baselinesError, setBaselinesError] = useState<string>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [training, setTraining] = useState<TrainingSample | undefined>();
  const [fellBack, setFellBack] = useState(false);
  const [finalFrames, setFinalFrames] = useState<FrameStats | undefined>();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'error'; text: string; id?: string; login?: boolean } | null>(null);
  const [previous, setPrevious] = useState<StoredAnalysis | null>(null);
  const [restored, setRestored] = useState<StoredAnalysis | null>(null);
  const [sampleKind, setSampleKind] = useState<SynthKind>('invoices');
  const [sampleRows, setSampleRows] = useState(50_000);

  const monitor = useMemo(() => new FrameMonitor(), []);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<AnalysisSession | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    const n = defaultWorkerCount();
    setMaxWorkers(Math.max(2, (navigator.hardwareConcurrency || 8) - 1));
    setWorkers(n);
  }, []);

  const loadBaselines = useCallback(async () => {
    try {
      setBaselines(await api.listBaselines());
      setBaselinesError(undefined);
    } catch (e) {
      setBaselinesError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadBaselines();
  }, [loadBaselines]);

  // offer the report of the previous visit (IndexedDB) — the original file is not stored, only the findings
  useEffect(() => {
    let alive = true;
    void loadLastAnalysis().then((p) => alive && setPrevious(p));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      sessionRef.current?.dispose();
      monitor.stop();
    },
    [monitor],
  );

  const buildOptions = (): Partial<AnalysisOptions> | string => {
    let baseline: BaselineRef | undefined;
    if (settings.mlMode === 'baseline') {
      const b = baselines.find((x) => x.id === settings.baselineId);
      if (!b) return 'Elige una línea base histórica o cambia el modo de IA.';
      baseline = { id: b.id, name: b.name, columns: b.columns, kinds: b.kinds as BaselineRef['kinds'], schemaSignature: b.schemaSignature };
    }
    const keys = settings.keyColumns.split(',').map((s) => s.trim()).filter(Boolean);
    return {
      sensitivity: settings.sensitivity,
      detectors: settings.detectors,
      dateOrder: settings.dateOrder,
      keyColumns: keys.length ? keys : undefined,
      ml: { mode: settings.mlMode, baseline, seed: 42 },
    };
  };

  const start = async (file: Blob, name: string): Promise<void> => {
    const options = buildOptions();
    if (typeof options === 'string') {
      setError(options);
      setPhase('error');
      return;
    }
    abortRef.current?.abort();
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSession(null);
    setTraining(undefined);
    setSelected(null);
    setSaveMsg(null);
    setError(null);
    setFinalFrames(undefined);
    setFellBack(false);
    setProgress(null);
    setFileInfo({ name, size: file.size });
    setPhase('running');
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++runId.current;
    // let React paint the "running" state before the main-thread mode starts blocking
    await new Promise((r) => setTimeout(r, 60));
    monitor.start();
    const t0 = performance.now();
    try {
      const out = await runAnalysis({ file, fileName: name, mode, workers, options, signal: controller.signal, onProgress: setProgress });
      const frames = monitor.stop();
      if (id !== runId.current) {
        out.session.dispose();
        return;
      }
      sessionRef.current = out.session;
      setSession(out.session);
      setTraining(out.training);
      setFellBack(out.baselineFellBack);
      setFinalFrames(frames);
      setRuns((r) => [...r, { id, file: name, rows: out.session.report.meta.rows, mode, workers: mode === 'main' ? 1 : mode === 'worker' ? 1 : workers, ms: performance.now() - t0, frames }]);
      setPhase('done');
    } catch (e) {
      monitor.stop();
      if (id !== runId.current) return;
      if (e instanceof AnalysisAborted || controller.signal.aborted) {
        setPhase('idle');
        return;
      }
      setError(errorMessage(e));
      setPhase('error');
    }
  };

  const startSample = async (): Promise<void> => {
    setPhase('generating');
    setError(null);
    await new Promise((r) => setTimeout(r, 60));
    const data = generateDataset({ kind: sampleKind, rows: sampleRows, seed: 7 });
    await start(data.blob, data.fileName);
  };

  const cancel = (): void => {
    runId.current++;
    abortRef.current?.abort();
    monitor.stop();
    setPhase('idle');
  };

  const report = session?.report;
  const busy = phase === 'running' || phase === 'generating';
  const loadRecord = useMemo(() => (session ? (i: number) => session.getRecord(i) : undefined), [session]);

  const save = async (): Promise<void> => {
    if (!report) return;
    setSaveMsg(null);
    try {
      const m = report.meta;
      const saved = await api.saveAnalysis({
        fileName: m.fileName,
        format: m.format,
        fileSizeBytes: m.fileSizeBytes,
        rows: m.rows,
        columns: report.columns,
        durationMs: Math.round(m.durationMs),
        mode: m.mode,
        workers: m.workers,
        sensitivity: m.sensitivity,
        mlMode: m.mlMode,
        baselineId: m.baselineId,
        findings: report.findings.slice(0, MAX_SAVED_FINDINGS),
      });
      const cut = report.findings.length > MAX_SAVED_FINDINGS ? ` Se guardaron los ${fmtInt(MAX_SAVED_FINDINGS)} hallazgos de mayor puntaje.` : '';
      setSaveMsg({ kind: 'ok', text: `Reporte guardado en el historial.${cut}`, id: saved.id });
    } catch (e) {
      setSaveMsg({ kind: 'error', text: errorMessage(e) });
    }
  };

  const defaultBaselineName = `${report?.meta.fileName.replace(/\.[^.]+$/, '') ?? 'Histórico'} · ${new Date().toLocaleDateString('es-CO')}`;

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Análisis</p>
        <h1 style={{ fontSize: '2rem' }}>Analizar un archivo</h1>
        <p className="muted" style={{ maxWidth: 720 }}>El archivo se lee y se revisa en este navegador. Elige cómo quieres procesarlo y compara.</p>
      </header>

      <section className="card stack" aria-label="Configuración">
        <ModeSelector mode={mode} onMode={setMode} workers={workers} onWorkers={setWorkers} maxWorkers={maxWorkers} disabled={busy} />
        <SettingsPanel value={settings} onChange={setSettings} baselines={baselines} baselinesError={baselinesError} disabled={busy} />
      </section>

      <Dropzone onFile={(f) => void start(f, f.name)} disabled={busy} />
      <div className="row small">
        <span className="muted">¿Sin archivo a la mano? Genera datos de ejemplo con anomalías conocidas:</span>
        <select className="input" aria-label="Tipo de datos de ejemplo" value={sampleKind} onChange={(e) => setSampleKind(e.target.value as SynthKind)} disabled={busy}>
          {SAMPLE_KINDS.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
        </select>
        <select className="input" aria-label="Cantidad de filas" value={sampleRows} onChange={(e) => setSampleRows(Number(e.target.value))} disabled={busy}>
          {SAMPLE_SIZES.map((n) => (<option key={n} value={n}>{fmtInt(n)} filas</option>))}
        </select>
        <button className="btn sm" onClick={() => void startSample()} disabled={busy} data-testid="sample-btn">Generar y analizar</button>
      </div>

      {(busy || phase === 'done') && (
        <section className="card stack" aria-label="Progreso" aria-live="polite">
          <div className="row spread">
            <div>
              <b>{fileInfo?.name}</b> <span className="muted small">{fileInfo ? fmtBytes(fileInfo.size) : ''} · {MODE_LABEL[mode]}</span>
            </div>
            {busy && phase === 'running' && <button className="btn sm" onClick={cancel}>Cancelar</button>}
          </div>
          {phase === 'generating' && <p className="muted">Generando datos de ejemplo…</p>}
          {phase === 'running' && (
            <>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.overall ?? 0) * 100)}>
                <i style={{ width: `${(progress?.overall ?? 0) * 100}%` }} />
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {progress?.message ?? 'Preparando…'} {progress?.rows ? `· ${fmtInt(progress.rows)} registros leídos` : ''}
              </p>
            </>
          )}
          <LiveMeter monitor={monitor} active={phase === 'running'} stats={finalFrames} />
          {phase === 'done' && report && (
            <p className="small" style={{ margin: 0 }}>
              Terminado en <b>{fmtMs(report.meta.durationMs)}</b>. Fases: {Object.entries(report.meta.phaseMs).map(([k, v]) => `${k} ${fmtMs(v)}`).join(' · ')}
            </p>
          )}
        </section>
      )}

      {error && <p className="alert error" role="alert">{error}</p>}

      {report && session && (
        <>
          {report.meta.warnings.map((w, i) => (<p key={i} className="alert warn small">{w}</p>))}
          {report.meta.truncated && <p className="alert warn small">Hay más hallazgos de los que se muestran: se conservaron los de mayor puntaje.</p>}
          {fellBack && <p className="alert warn small">El servicio de IA no respondió; se usó el modelo local de este navegador.</p>}

          <Summary data={{ rows: report.meta.rows, columns: report.meta.columns, findingsCount: report.totalFindings, recordsAffected: report.recordsAffected, byRisk: report.byRisk, byType: report.byType }} />

          <div className="row">
            <button className="btn" onClick={() => downloadText(`${report.meta.fileName}.anomalias.csv`, findingsToCsv(report.findings), 'text/csv')}>Descargar CSV</button>
            <button className="btn" onClick={() => downloadText(`${report.meta.fileName}.anomalias.json`, findingsToJson(report.findings), 'application/json')}>Descargar JSON</button>
            <button className="btn primary" onClick={() => void save()}>Guardar en historial</button>
            {saveMsg && (
              <span className={`small ${saveMsg.kind === 'error' ? '' : 'muted'}`} role="status" style={saveMsg.kind === 'error' ? { color: 'var(--critical)' } : undefined}>
                {saveMsg.text} {saveMsg.id && <Link href={`/reportes/${saveMsg.id}`}>Abrir reporte</Link>}
              </span>
            )}
          </div>

          <ReportTable findings={report.findings} selected={selected} onOpen={setSelected} />
          {selected && <RecordDrawer finding={selected} findings={report.findings} loadRecord={loadRecord} onClose={() => setSelected(null)} />}

          <BaselinePanel training={training} defaultName={defaultBaselineName} baselines={baselines} onChanged={() => void loadBaselines()} />
        </>
      )}

      {runs.length > 0 && (
        <section className="card" aria-label="Comparación de ejecuciones">
          <h3>Comparación de ejecuciones en esta sesión</h3>
          <div className="table-scroll">
            <table className="plain">
              <thead><tr><th>Archivo</th><th>Registros</th><th>Modo</th><th>Tiempo</th><th>Pausa más larga</th><th>Congelamientos</th><th>FPS</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.file}</td>
                    <td className="mono">{fmtInt(r.rows)}</td>
                    <td>{MODE_LABEL[r.mode]}{r.mode === 'pool' ? ` (${r.workers})` : ''}</td>
                    <td className="mono">{fmtMs(r.ms)}</td>
                    <td className="mono" style={{ color: r.frames.maxGapMs > 100 ? 'var(--critical)' : undefined }}>{fmtMs(r.frames.maxGapMs)}</td>
                    <td className="mono">{r.frames.freezes}</td>
                    <td className="mono">{Math.round(r.frames.fps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
