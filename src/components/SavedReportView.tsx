'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Finding } from '@/engine';
import { api, errorMessage } from '@/lib/api';
import { RecordDrawer } from './RecordDrawer';
import { ReportTable } from './ReportTable';

export function SavedReportView({ id, findings, total, csvUrl }: { id: string; findings: Finding[]; total: number; csvUrl: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Finding | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    if (!window.confirm('¿Eliminar este reporte del historial? No se puede deshacer.')) return;
    try {
      await api.deleteAnalysis(id);
      router.push('/reportes');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <a className="btn" href={csvUrl}>Descargar CSV completo</a>
        <button className="btn danger" onClick={() => void remove()}>Eliminar reporte</button>
        {total > findings.length && <span className="small muted">Se muestran los {findings.length.toLocaleString('es-CO')} hallazgos de mayor puntaje de {total.toLocaleString('es-CO')}; el CSV trae todos.</span>}
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <ReportTable findings={findings} selected={selected} onOpen={setSelected} />
      {selected && <RecordDrawer finding={selected} findings={findings} onClose={() => setSelected(null)} />}
    </div>
  );
}
