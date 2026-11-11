import type { Metadata } from 'next';
import Link from 'next/link';
import { RealtimeRefresher } from '@/components/RealtimeRefresher';
import { RiskChip } from '@/components/Summary';
import { errorMessage, isAuthError, type AnalysisSummary } from '@/lib/api';
import { serverApi } from '@/lib/serverApi';
import { fmtBytes, fmtDate, fmtInt, fmtMs } from '@/lib/format';

export const metadata: Metadata = { title: 'Historial de reportes' };
// SSR: always fresh data from the backend, rendered on the server for each request.
// Render's free backend can take ~1 min to wake up: give the server render time (Vercel Hobby allows up to 60 s)
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MODE: Record<string, string> = { main: 'Hilo principal', worker: '1 worker', pool: 'Workers' };

export default async function ReportsPage() {
  let items: AnalysisSummary[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    const page = await api.listAnalyses(50, 0);
    items = page.items;
    total = page.total;
  } catch (e) {
    error = errorMessage(e);
  }

  return (
    <div className="stack">
      <header className="row spread">
        <div>
          <p className="eyebrow">Historial</p>
          <h1 style={{ fontSize: '2rem', margin: 0 }}>Reportes guardados</h1>
        </div>
        <RealtimeRefresher />
      </header>

      {error && (
        <div className="alert error" role="alert">
          <b>No se pudo cargar el historial.</b> {error}
          <br />
          <span className="small muted">El análisis de archivos sigue funcionando sin backend; solo el historial lo necesita.</span>
        </div>
      )}

      {!error && items.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>Todavía no hay reportes. <Link href="/analizar">Analiza un archivo</Link> y pulsa «Guardar en historial».</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="card table-scroll">
          <table className="plain">
            <thead>
              <tr><th>Archivo</th><th>Fecha</th><th>Registros</th><th>Hallazgos</th><th>Riesgo</th><th>Procesamiento</th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/reportes/${a.id}`}><b>{a.fileName}</b></Link>
                    <div className="small muted">{a.format.toUpperCase()} · {fmtBytes(a.fileSizeBytes)}</div>
                  </td>
                  <td className="small">{fmtDate(a.createdAt)}</td>
                  <td className="mono">{fmtInt(a.rows)}</td>
                  <td className="mono">{fmtInt(a.findingsCount)}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {a.byRisk.critical > 0 && <RiskChip risk="critical" />}
                      {a.byRisk.high > 0 && <RiskChip risk="high" />}
                      {a.byRisk.critical + a.byRisk.high === 0 && <RiskChip risk={a.byRisk.medium > 0 ? 'medium' : 'low'} />}
                    </span>
                  </td>
                  <td className="small">{MODE[a.mode] ?? a.mode}{a.mode === 'pool' ? ` (${a.workers})` : ''} · {fmtMs(a.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > items.length && <p className="small muted">Mostrando {items.length} de {fmtInt(total)}.</p>}
        </div>
      )}
    </div>
  );
}
