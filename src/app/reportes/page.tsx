import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { RealtimeRefresher } from '@/components/RealtimeRefresher';
import { RISK_COLOR } from '@/components/Summary';
import { errorMessage, isAuthError, type AnalysisSummary } from '@/lib/api';
import { serverApi } from '@/lib/serverApi';
import { RISK_ORDER, fmtBytes, fmtDate, fmtInt, fmtMs } from '@/lib/format';

export const metadata: Metadata = { title: 'Historial de reportes' };
// SSR: always fresh data from the backend, rendered on the server for each request.
// Render's free backend can take ~1 min to wake up: give the server render time (Vercel Hobby allows up to 60 s)
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const FORMAT_ICON: Record<string, IconName> = { csv: 'table', tsv: 'table', xlsx: 'table', json: 'braces', ndjson: 'braces', pdf: 'file' };

/** Stacked bar of the findings by risk level (the colour is never alone: the counts are written next to it). */
function RiskBar({ byRisk }: { byRisk: AnalysisSummary['byRisk'] }) {
  const total = RISK_ORDER.reduce((s, r) => s + (byRisk[r] ?? 0), 0);
  if (total === 0) return null;
  return (
    <span className="risk-bar" aria-hidden="true">
      {RISK_ORDER.map((r) => ((byRisk[r] ?? 0) > 0 ? <i key={r} style={{ flexGrow: byRisk[r], background: RISK_COLOR[r] }} /> : null))}
    </span>
  );
}

export default async function ReportsPage() {
  let items: AnalysisSummary[] = [];
  let total = 0;
  let error: string | null = null;
  let needsLogin = false;
  try {
    const page = await serverApi().listAnalyses(50, 0);
    items = page.items;
    total = page.total;
  } catch (e) {
    if (isAuthError(e)) needsLogin = true;
    else error = errorMessage(e);
  }

  const partial = total > items.length;
  const rows = items.reduce((s, a) => s + a.rows, 0);
  const critical = items.reduce((s, a) => s + (a.byRisk.critical ?? 0), 0);
  const clean = items.filter((a) => a.findingsCount === 0).length;

  return (
    <div className="stack reports">
      <header className="page-head">
        <div>
          <p className="eyebrow">Historial</p>
          <h1>Reportes guardados</h1>
          <p>Los reportes que guardaste desde Analizar. Se guardan en tu cuenta; el archivo original nunca se sube.</p>
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

      {needsLogin && (
        <div className="card empty-state">
          <span className="icon-tile"><Icon name="lock" /></span>
          <div>
            <h2 className="card-title">Tu historial es privado</h2>
            <p className="small muted" style={{ margin: '2px 0 12px' }}>Ingresa para ver los reportes que guardaste.</p>
            <Link className="btn primary" href="/ingresar?next=/reportes"><Icon name="logIn" size={16} /> Ingresar</Link>
          </div>
        </div>
      )}

      {!error && !needsLogin && items.length === 0 && (
        <div className="card empty-state">
          <span className="icon-tile"><Icon name="history" /></span>
          <div>
            <h2 className="card-title">Todavía no hay reportes</h2>
            <p className="small muted" style={{ margin: '2px 0 12px' }}>Analiza un archivo y pulsa «Guardar en historial».</p>
            <Link className="btn primary" href="/analizar"><Icon name="play" size={14} /> Analizar un archivo</Link>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="grid cols-3 stats">
            <div className="card stat">
              <span className="stat-label">Reportes guardados <Icon name="history" size={16} /></span>
              <b>{fmtInt(total)}</b>
              <span>{clean > 0 ? `${fmtInt(clean)} sin hallazgos` : 'en tu historial'}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Registros revisados <Icon name="table" size={16} /></span>
              <b>{fmtInt(rows)}</b>
              <span>{partial ? `en los ${fmtInt(items.length)} más recientes` : 'en todos tus reportes'}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Hallazgos críticos <Icon name="alert" size={16} /></span>
              <b style={{ color: critical > 0 ? 'var(--critical-text)' : undefined }}>{fmtInt(critical)}</b>
              <span>{partial ? `en los ${fmtInt(items.length)} más recientes` : 'en todos tus reportes'}</span>
            </div>
          </div>

          <div className="card table-card">
            <div className="table-card-head">
              <h2 className="card-title">Reportes <span className="tag">{fmtInt(total)}</span></h2>
              {partial && <span className="small muted">Mostrando los {fmtInt(items.length)} más recientes de {fmtInt(total)}</span>}
            </div>
            <div className="table-scroll">
              <table className="plain history">
                <thead>
                  <tr><th>Archivo</th><th>Fecha</th><th>Registros</th><th>Hallazgos y severidad</th><th>Tiempo</th><th><span className="sr-only">Acciones</span></th></tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Archivo">
                        <span className="file-cell">
                          <span className="file-icon"><Icon name={FORMAT_ICON[a.format] ?? 'file'} size={18} /></span>
                          <span>
                            <Link href={`/reportes/${a.id}`} className="file-name">{a.fileName}</Link>
                            <span className="small muted mono">{a.format.toUpperCase()} · {fmtBytes(a.fileSizeBytes)}</span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Fecha" className="small">{fmtDate(a.createdAt)}</td>
                      <td data-label="Registros" className="mono">{fmtInt(a.rows)}</td>
                      <td data-label="Hallazgos">
                        {a.findingsCount === 0 ? (
                          <span className="chip ok"><Icon name="check" size={12} /> Sin hallazgos</span>
                        ) : (
                          <span className="sev-cell">
                            <span className="row small" style={{ justifyContent: 'space-between', gap: 8 }}>
                              <span>{fmtInt(a.findingsCount)} hallazgos</span>
                              {a.byRisk.critical > 0 && <span style={{ color: 'var(--critical-text)', fontWeight: 600 }}>{fmtInt(a.byRisk.critical)} críticos</span>}
                            </span>
                            <RiskBar byRisk={a.byRisk} />
                          </span>
                        )}
                      </td>
                      <td data-label="Tiempo" className="mono small">{fmtMs(a.durationMs)}</td>
                      <td className="cell-action">
                        <Link className="btn sm" href={`/reportes/${a.id}`}>Abrir reporte <Icon name="chevronRight" size={14} /></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
