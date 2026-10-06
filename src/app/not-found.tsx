import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h1 style={{ fontSize: '1.8rem' }}>No encontramos esa página</h1>
      <p className="muted">Puede que el reporte haya sido eliminado.</p>
      <Link className="btn primary" href="/">Volver al inicio</Link>
    </div>
  );
}
