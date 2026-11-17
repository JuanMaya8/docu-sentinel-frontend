import Link from 'next/link';

// SSG: this page has no per-request data, so it is prerendered at build time and served from the CDN.
export const dynamic = 'force-static';

const DETECTORS = [
  ['Duplicados', 'Exactos, por clave (mismo ID, datos distintos) y casi idénticos.'],
  ['Campos faltantes', 'Solo marca los vacíos en columnas que casi siempre vienen llenas.'],
  ['Tipos y formatos', 'Texto en columnas numéricas, fechas imposibles, correos inválidos, etiquetas escritas de varias formas.'],
  ['Rangos', 'Valores extremos según la distribución real de la columna, negativos y edades o fechas absurdas.'],
  ['Relaciones', 'Descubre solas reglas como cantidad × precio = subtotal o emisión ≤ vencimiento y señala quién las rompe.'],
  ['Sospechosos', 'Montos pegados justo bajo un umbral de aprobación, redondeos y la ley de Benford.'],
];

export default function HomePage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Detección de inconsistencias · 100 % en tu navegador</p>
        <h1>Encuentra lo que está mal en tus archivos antes de que cueste dinero.</h1>
        <p className="lead">
          Sube un CSV, JSON o PDF con tablas. Docu Sentinel revisa cada registro con reglas y con un modelo de IA que aprende de tus datos históricos, y te
          entrega un reporte explicado en español. Tu archivo no sale de tu equipo y funciona aunque tenga cientos de miles de filas.
        </p>
        <div className="row">
          <Link className="btn primary" href="/analizar">Analizar un archivo</Link>
          <Link className="btn" href="/reportes">Ver mis reportes</Link>
        </div>
      </section>

      <section aria-labelledby="como">
        <h2 id="como">Cómo funciona</h2>
        <div className="pipeline">
          {[
            ['1 · LECTURA', 'Reconoce el formato (CSV, JSON, Excel o PDF) y lee cada registro.'],
            ['2 · PERFIL', 'Aprende cómo son normalmente tus columnas: tipos, rangos y valores frecuentes.'],
            ['3 · REGLAS', 'Busca duplicados, vacíos, formatos inválidos y relaciones que no cuadran.'],
            ['4 · IA', 'Un modelo aprende el patrón normal de tus datos (o de tu histórico) y señala lo que se aparta.'],
            ['5 · RIESGO', 'Cada hallazgo recibe un nivel de riesgo: bajo, medio, alto o crítico.'],
            ['6 · REPORTE', 'Registro, campo afectado y explicación en español, listo para descargar o guardar.'],
          ].map(([t, d]) => (
            <div className="step" key={t}>
              <b>{t}</b>
              {d}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="que">
        <h2 id="que">Qué detecta</h2>
        <div className="grid cols-3">
          {DETECTORS.map(([t, d]) => (
            <div className="card flat" key={t}>
              <h3>{t}</h3>
              <p className="muted small" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="dif">
        <h2 id="dif">Rápido aunque el archivo sea enorme</h2>
        <p>
          En <Link href="/analizar">Analizar</Link> eliges la velocidad: <b>Rápido</b> reparte el archivo en partes que se revisan al mismo tiempo,
          <b> En segundo plano</b> lo revisa sin trabar la página y <b>Básico</b> lo hace todo de una vez. Un medidor en vivo muestra si la página se
          traba. En <Link href="/benchmark">Comparar velocidad</Link> se analiza el mismo archivo con las tres y se comparan el tiempo y la fluidez.
        </p>
      </section>
    </div>
  );
}
