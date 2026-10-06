import type { Metadata } from 'next';
import AnalyzerLoader from '@/components/AnalyzerLoader';

export const metadata: Metadata = { title: 'Analizar un archivo' };

// CSR: the analysis needs Blob/Worker/File APIs that only exist in the browser, so the interactive part is loaded with ssr:false.
export default function AnalyzePage() {
  return <AnalyzerLoader />;
}
