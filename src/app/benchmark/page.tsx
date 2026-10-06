import type { Metadata } from 'next';
import BenchmarkLoader from '@/components/BenchmarkLoader';

export const metadata: Metadata = { title: 'Benchmark: hilo principal vs workers' };

// CSR (see analizar/page.tsx)
export default function BenchmarkPage() {
  return <BenchmarkLoader />;
}
