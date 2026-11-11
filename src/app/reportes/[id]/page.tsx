import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
        <div className="card">
          <p style={{ margin: 0 }}>Este reporte es privado. <Link href={`/ingresar?next=/reportes/${encodeURIComponent(params.id)}`}>Ingresa</Link> con la cuenta que lo guardó.</p>
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
      <header>
        <p className="eyebrow"><Link href="/reportes">← Historial</Link></p>
        <h1 style={{ fontSize: '2rem', marginBottom: 4 }}>{detail.fileName}</h1>
        <p className="muted small">
          {detail.format.toUpperCase()} · {fmtBytes(detail.fileSizeBytes)} · {fmtDate(detail.createdAt)} · procesado en {fmtMs(detail.durationMs)} ({detail.mode === 'pool' ? `${detail.workers} workers` : detail.mode === 'worker' ? '1 worker' : 'hilo principal'}) · sensibilidad {detail.sensitivity} · IA: {detail.mlMode}
        </p>
      </header>
      <Summary data={{ rows: detail.rows, columns: detail.columnCount, findingsCount: detail.findingsCount, recordsAffected: detail.recordsAffected, byRisk: detail.byRisk, byType: detail.byType }} />
      <SavedReportView id={detail.id} findings={findings.items} total={findings.total} csvUrl={api.exportCsvUrl(detail.id)} />
    </div>
  );
}
