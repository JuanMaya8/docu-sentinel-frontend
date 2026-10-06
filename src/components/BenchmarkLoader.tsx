'use client';

import dynamic from 'next/dynamic';

const BenchmarkView = dynamic(() => import('./BenchmarkView'), {
  ssr: false,
  loading: () => (
    <div className="stack" aria-busy="true">
      <div className="skeleton" style={{ height: 60, width: 360 }} />
      <div className="skeleton" style={{ height: 160 }} />
    </div>
  ),
});

export default function BenchmarkLoader() {
  return <BenchmarkView />;
}
