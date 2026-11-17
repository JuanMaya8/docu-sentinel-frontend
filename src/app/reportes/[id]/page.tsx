import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { SavedReportView } from '@/components/SavedReportView';
import { Summary } from '@/components/Summary';
import { ApiError, errorMessage, isAuthError, type AnalysisDetail, type Page } from '@/lib/api';
import { serverApi } from '@/lib/serverApi';
import type { Finding } from '@/engine';
import { fmtBytes, fmtDate, fmtMs } from '@/lib/format';

// Render's free backend can take ~1 min to wake up: give the server render time (Vercel Hobby allows up to 60 s)
export const maxDuration = 60;
export const dynamic = 'force-dynamic'; // SSR on every request
const FINDINGS_LIMIT = 5000;
const SENSITIVITY_ES: Record<string, string> = { low: 'baja', medium: 'media', high: 'alta' };
const ML_ES: Record<string, string> = { local: 'aprendió de este archivo', baseline: 'comparó con una línea base', off: 'sin IA' };

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  try {
    const a = await serverApi().getAnalysis(params.id);
    return { title: `Reporte · ${a.fileName}` };
  } catch {
    return { title: 'Reporte' };
  }
}

export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  let detail: AnalysisDetail;
  let findings: Page<Finding>;
  try {
    const api = serverApi();
    [detail, findings] = await Promise.all([api.getAnalysis(params.id), api.getFindings(params.id, { sort: 'score:desc', limit: FINDINGS_LIMIT })]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (isAuthError(e)) {
      return (
        <div className="card empty-state">
          <span className="icon-tile"><Icon name="lock" /></span>
          <div>
            <h2 className="card-title">Este reporte es privado</h2>
            <p className="small muted" style={{ margin: '2px 0 12px' }}>Ingresa con la cuenta que lo guardó.</p>
            <Link className="btn primary" href={`/ingresar?next=/reportes/${encodeURIComponent(params.id)}`}><Icon name="logIn" size={16} /> Ingresar</Link>
          </div>
        </div>
      );
    }
    return (
      <div className="alert error" role="alert">
        <b>No se pudo cargar el reporte.</b> {errorMessage(e)} <Link href="/reportes">Volver al historial</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div style={{ minWidth: 0 }}>
          <nav aria-label="Ruta" className="crumbs small">
            <Link href="/reportes"><Icon name="arrowLeft" size={14} /> Historial</Link>
            <span aria-hidden="true">/</span>
            <span className="mono">{detail.fileName}</span>
          </nav>
          <h1 className="report-title">{detail.fileName}</h1>
          <div className="meta-tags">
            <span className="tag">{detail.format.toUpperCase()}</span>
            <span className="tag">{fmtBytes(detail.fileSizeBytes)}</span>
            <span className="tag">{fmtDate(detail.createdAt)}</span>
            <span className="tag">revisado en {fmtMs(detail.durationMs)}</span>
            <span className="tag">sensibilidad {SENSITIVITY_ES[detail.sensitivity] ?? detail.sensitivity}</span>
            <span className="tag">IA: {ML_ES[detail.mlMode] ?? detail.mlMode}</span>
          </div>
        </div>
      </header>
      <Summary data={{ rows: detail.rows, columns: detail.columnCount, findingsCount: detail.findingsCount, recordsAffected: detail.recordsAffected, byRisk: detail.byRisk, byType: detail.byType }} />
      <SavedReportView id={detail.id} fileName={detail.fileName} findings={findings.items} total={findings.total} />
    </div>
  );
}
