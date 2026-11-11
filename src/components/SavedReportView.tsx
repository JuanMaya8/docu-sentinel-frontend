'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Finding } from '@/engine';
import { api, errorMessage } from '@/lib/api';
import { RecordDrawer } from './RecordDrawer';
import { ReportTable } from './ReportTable';

export function SavedReportView({ id, fileName, findings, total }: { id: string; fileName: string; findings: Finding[]; total: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Finding | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (kind: 'csv' | 'json'): Promise<void> => {
    setError(null);
    try {
      await api.downloadExport(id, kind, `${fileName}.anomalias.${kind}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

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
        <button className="btn" onClick={() => void download('csv')}>Descargar CSV completo</button>
        <button className="btn" onClick={() => void download('json')}>Descargar JSON</button>
        <button className="btn danger" onClick={() => void remove()}>Eliminar reporte</button>
        {total > findings.length && <span className="small muted">Se muestran los {findings.length.toLocaleString('es-CO')} hallazgos de mayor puntaje de {total.toLocaleString('es-CO')}; el CSV y el JSON traen todos.</span>}
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <ReportTable findings={findings} selected={selected} onOpen={setSelected} />
      {selected && <RecordDrawer finding={selected} findings={findings} onClose={() => setSelected(null)} />}
    </div>
  );
}
