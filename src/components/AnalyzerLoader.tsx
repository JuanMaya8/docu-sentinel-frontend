'use client';

import dynamic from 'next/dynamic';

const Analyzer = dynamic(() => import('./Analyzer'), {
  ssr: false,
  loading: () => (
    <div className="stack" aria-busy="true">
      <div className="skeleton" style={{ height: 60, width: 320 }} />
      <div className="skeleton" style={{ height: 220 }} />
      <div className="skeleton" style={{ height: 140 }} />
    </div>
  ),
});

export default function AnalyzerLoader() {
  return <Analyzer />;
}
