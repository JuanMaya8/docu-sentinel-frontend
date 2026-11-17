import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';

// SSG: this page has no per-request data, so it is prerendered at build time and served from the CDN.
export const dynamic = 'force-static';

const DETECTORS: Array<[IconName, string, string]> = [
  ['layers', 'Duplicados', 'Exactos, por clave (mismo ID, datos distintos) y casi idénticos.'],
  ['list', 'Campos faltantes', 'Solo marca los vacíos en columnas que casi siempre vienen llenas.'],
  ['braces', 'Tipos y formatos', 'Texto en columnas numéricas, fechas imposibles, correos inválidos, etiquetas escritas de varias formas.'],
  ['barChart', 'Rangos', 'Valores extremos según la distribución real de la columna, negativos y edades o fechas absurdas.'],
  ['table', 'Relaciones', 'Descubre solas reglas como cantidad × precio = subtotal o emisión ≤ vencimiento y señala quién las rompe.'],
  ['alert', 'Sospechosos', 'Montos pegados justo bajo un umbral de aprobación, redondeos y la ley de Benford.'],
];

const STEPS: Array<[string, string]> = [
  ['Lectura', 'Reconoce el formato (CSV, JSON, Excel o PDF) y lee cada registro.'],
  ['Perfil', 'Aprende cómo son normalmente tus columnas: tipos, rangos y valores frecuentes.'],
  ['Reglas', 'Busca duplicados, vacíos, formatos inválidos y relaciones que no cuadran.'],
  ['IA', 'Un modelo aprende el patrón normal de tus datos (o de tu histórico) y señala lo que se aparta.'],
  ['Riesgo', 'Cada hallazgo recibe un nivel de riesgo: bajo, medio, alto o crítico.'],
  ['Reporte', 'Registro, campo afectado y explicación en español, listo para descargar o guardar.'],
];

/** The formats the file picker accepts (see Dropzone's ACCEPT list). */
const FORMATS: Array<[string, string, string]> = [
  ['.csv', 'CSV', 'Separado por comas o punto y coma'],
  ['.tsv', 'TSV', 'Separado por tabulaciones'],
  ['{ }', 'JSON', 'Lista de objetos'],
  ['.ndjson', 'NDJSON', 'Un objeto por línea'],
  ['.xlsx', 'Excel', 'Primera hoja del libro'],
  ['PDF', 'PDF con tablas', 'Extrae las tablas del texto'],
];

const BENEFITS: Array<[IconName, string, string]> = [
  ['lock', 'Privado', 'El archivo se revisa en tu navegador; no se sube a ningún servidor.'],
  ['gauge', 'Para archivos grandes', 'Cientos de miles de registros en segundos, sin que la página se trabe.'],
  ['info', 'Explicado en español', 'Cada hallazgo dice qué registro, qué campo y por qué se marcó.'],
  ['sparkles', 'Aprende de tu historia', 'Guarda un archivo como referencia y la IA marca lo que se sale de lo normal en los siguientes.'],
  ['history', 'Historial privado', 'Con tu cuenta, guarda los reportes y vuelve a ellos cuando quieras.'],
  ['download', 'Listo para compartir', 'Descarga el resultado para Excel (CSV) o en JSON.'],
];

export default function HomePage() {
  return (
    <div className="home">
      <section className="hero">
        <p className="pill"><Icon name="lock" size={13} /> Análisis en tu navegador · tu archivo no sale de tu equipo</p>
        <h1>
          Detecta inconsistencias en tus documentos <span className="accent">sin subirlos a ningún servidor</span>
        </h1>
        <p className="lead">
          Sube un CSV, JSON, Excel o PDF con tablas. Docu Sentinel revisa cada registro con reglas y con un modelo de IA que aprende de tus datos, y te
          entrega un reporte explicado en español.
        </p>
        <div className="row hero-actions">
          <Link className="btn primary lg" href="/analizar"><Icon name="play" size={16} /> Analizar un archivo</Link>
          <Link className="btn lg" href="/reportes"><Icon name="history" size={16} /> Ver mis reportes</Link>
        </div>
        <ul className="trust">
          <li><Icon name="check" size={14} /> No necesitas cuenta para analizar</li>
          <li><Icon name="check" size={14} /> Explicaciones en español</li>
          <li><Icon name="check" size={14} /> Descarga para Excel</li>
        </ul>
      </section>

      <section aria-labelledby="que">
        <p className="eyebrow">Qué detecta</p>
        <h2 id="que">Seis familias de problemas, en cada registro</h2>
        <div className="grid cols-3">
          {DETECTORS.map(([icon, t, d]) => (
            <article className="card feature" key={t}>
              <span className="icon-tile"><Icon name={icon} /></span>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="como">
        <p className="eyebrow">Cómo funciona</p>
        <h2 id="como">Del archivo al reporte en seis pasos</h2>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="step-n mono">{String(i + 1).padStart(2, '0')}</span>
              <b>{t}</b>
              <span className="muted">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card formats" aria-labelledby="formatos">
        <div className="page-head">
          <div>
            <p className="eyebrow">Formatos</p>
            <h2 id="formatos" style={{ margin: 0 }}>Formatos compatibles sin configuración</h2>
          </div>
          <p className="small muted" style={{ maxWidth: 360 }}>Detecta solo el separador y el formato de las fechas de cada columna.</p>
        </div>
        <div className="format-grid">
          {FORMATS.map(([tag, name, hint]) => (
            <div className="format" key={name}>
              <span className="tag">{tag}</span>
              <b>{name}</b>
              <span className="small muted">{hint}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="por-que">
        <p className="eyebrow">Por qué usarlo</p>
        <h2 id="por-que">Pensado para quien revisa los datos</h2>
        <div className="grid cols-3">
          {BENEFITS.map(([icon, t, d]) => (
            <article className="card feature" key={t}>
              <span className="icon-tile"><Icon name={icon} /></span>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card cta" aria-labelledby="empieza">
        <div>
          <p className="eyebrow">Empieza en segundos</p>
          <h2 id="empieza">¿Listo para revisar tu primer archivo?</h2>
          <p className="muted">No necesitas registrarte para analizar. Si no tienes un archivo a la mano, puedes probar con datos de ejemplo que traen errores a propósito.</p>
          <Link className="btn primary lg" href="/analizar">Analizar un archivo <Icon name="arrowRight" size={16} /></Link>
        </div>
        <Link href="/analizar" className="cta-drop">
          <Icon name="upload" size={30} />
          <b>Arrastra tu archivo en la página de análisis</b>
          <span className="small muted">.csv · .tsv · .json · .ndjson · .xlsx · .pdf</span>
        </Link>
      </section>
    </div>
  );
}
