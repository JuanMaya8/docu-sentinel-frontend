# docu-sentinel-frontend

Interfaz y **motor de análisis** del proyecto *Motor Inteligente para Detectar Inconsistencias en Documentos*.
Es el repositorio principal del sistema (junto a `docu-sentinel-backend` y `docu-sentinel-ai`).

Sube un **CSV, TSV, JSON, NDJSON o PDF** (con tablas de texto) y obtén un reporte con **Registro · Tipo de anomalía · Nivel de riesgo · Campo afectado · Explicación**.
Todo el análisis corre **en el navegador, en Web Workers**: el archivo no se sube a ningún servidor.

> **Estado: v0.2.0 — funcional y verificado** (41 pruebas del motor, `next build`, Chromium real y E2E con backend + IA
> reales). Lee *Qué está hecho y qué no* y `AI_CONTEXT.md`.

## Cómo ejecutarlo

Requisitos: **Node 18.18+** (recomendado 20). No hace falta tener el backend para analizar archivos; solo el historial y las líneas base lo usan.

```bash
npm install
cp .env.example .env.local        # ajusta NEXT_PUBLIC_API_URL si el backend no está en :3001
npm run dev                       # http://localhost:3000
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo (copia antes el worker de pdf.js a `public/`) |
| `npm run build && npm start` | Build de producción y servidor |
| `npm test` | **39 pruebas** del motor (Node, sin navegador): parsers, detectores, determinismo, PDF |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:browser` | Verificación en **Chromium real** (Playwright + esbuild): Workers, PDF, cancelación y **benchmark Hilo principal vs Workers**. `SIZES=50000,200000,500000 REPS=2 npm run verify:browser`. La primera vez: `npx playwright install chromium` |
| `docker build -t docu-sentinel-frontend --build-arg NEXT_PUBLIC_API_URL=https://tu-backend/api/v1 .` | Imagen de producción (Next *standalone*) |

Rutas: `/` · `/analizar` · `/benchmark` · `/reportes` · `/reportes/[id]`.
Para probar sin archivos, en **Analizar** pulsa «Generar y analizar» (datos de ejemplo con anomalías conocidas).

### Con todo el sistema (3 repos)
```bash
# terminal 1 — IA                (docu-sentinel-ai)       uvicorn app.main:app --port 8000
# terminal 2 — backend           (docu-sentinel-backend)  npm run start:dev      # :3001
# terminal 3 — este repo         npm run dev                                    # :3000
```
El backend tiene un `docker-compose.yml` que levanta backend + IA juntos.

## Arquitectura completa

```
                    ┌─────────────────────────── NAVEGADOR ───────────────────────────┐
  archivo ─────────►│  Next.js 14 (App Router) · React 18                               │
  (CSV/JSON/PDF)    │   ├─ UI: dropzone · modos · progreso · medidor FPS · tabla virtual │
                    │   └─ Coordinador (hilo principal, solo enruta y mezcla cosas chicas)│
                    │        │  postMessage (tipado)                                      │
                    │   ┌────▼────┐ ┌─────────┐ ┌─────────┐        Web Workers            │
                    │   │ Worker 1│ │ Worker 2│ │ Worker N│  ShardEngine: parseo, perfil, │
                    │   └─────────┘ └─────────┘ └─────────┘  detectores, Isolation Forest │
                    └────────────────┬─────────────────────────────────────────────────┘
                                     │ solo RESULTADOS (hallazgos) y matrices numéricas
                      REST /api/v1 + socket.io
                    ┌────────────────▼─────────────┐   REST /v1   ┌──────────────────────┐
                    │ docu-sentinel-backend (NestJS)│────────────►│ docu-sentinel-ai      │
                    │ historial · líneas base · WS  │◄────────────│ FastAPI · IsolationFo.│
                    └───────────────────────────────┘             └──────────────────────┘
```

* **Frontend (este repo)**: Next.js 14 + TypeScript estricto, sin librerías de UI ni de gráficos (SVG propio), tabla virtualizada propia. Dependencias de producción: `next`, `react`, `react-dom`, `pdfjs-dist`, `socket.io-client`.
* **Motor** (`src/engine`): TypeScript puro, sin dependencias de navegador → se prueba en Node con `tsx --test` y corre idéntico en un Worker o en el hilo principal.
* **Backend** y **IA**: ver sus READMEs. El contrato exacto entre los tres está en [`docs/CONTRACT.md`](docs/CONTRACT.md) (idéntico en los tres repos).

### Patrón de renderizado (y por qué)

No hay un único patrón correcto: cada ruta usa el que le corresponde.

| Ruta | Patrón | Por qué |
|---|---|---|
| `/` | **SSG** (`force-static`) | Contenido fijo: se genera en el build y sale del CDN, carga instantánea y buen SEO. |
| `/analizar`, `/benchmark` | **CSR** (`dynamic(..., { ssr: false })`) | Dependen de `File`, `Blob`, `Worker`, `requestAnimationFrame`. No hay nada útil que renderizar en el servidor y así el JS del motor (parte pesada) no entra al bundle inicial del resto del sitio. |
| `/reportes`, `/reportes/[id]` | **SSR** (`force-dynamic`) | Datos del backend que cambian y se comparten por enlace: se renderizan en el servidor con datos frescos (`cache: 'no-store'`); un cliente `socket.io` pide `router.refresh()` cuando llega `analysis.saved`. |

Dentro del cliente, la **tabla de hallazgos está virtualizada** (solo ~25 filas existen en el DOM aunque haya 200 000) y el progreso se actualiza por mensajes, sin bloquear.

### El motor, por dentro

Pipeline: **PLAN → PARSE (+perfil) → STATS → [IA: features → entrenar] → DETECT → RESOLVE**

1. **PLAN** — detecta formato y codificación (UTF-8 / Windows-1252) y parte el archivo en bloques por bytes. En CSV los límites respetan comillas y saltos de línea dentro de campos (escáner de bytes).
2. **PARSE** — cada worker lee su bloque, lo guarda en columnas y perfila (tipos, nulos, categorías, formatos de fecha). Los perfiles son *mezclables*.
3. **STATS** — cuantiles con **DDSketch (error 1 %)** y distintos con **KMV (k = 1024)**: estructuras que se mezclan sin guardar todos los valores. Ley de Benford, múltiplos de 1000, umbrales con acumulación.
4. **IA** — Isolation Forest propio (con guarda de extrapolación) + modelo de **coherencia multivariante** (Mahalanobis recortado) que detecta relaciones rotas. Positivos asimétricos (dinero) se modelan en escala logarítmica. Se entrena **dentro de un worker**.
5. **DETECT** — cada worker aplica reglas y modelo a sus registros.
6. **RESOLVE** — se mezclan hallazgos, se resuelven duplicados globales, se ordena de forma total y determinista.

**Determinismo**: el resultado es **idéntico con 1, 2, 3 o 4 workers y en hilo principal** (hay pruebas y se vuelve a comprobar en Chromium). Índices globales, PRNG con semilla y sketches mezclables lo hacen posible.

| Detector | Tipos de anomalía |
|---|---|
| Duplicados | exacto · por clave (mismo ID, datos distintos) · casi idéntico |
| Faltantes | campo faltante (solo en columnas que casi siempre vienen llenas) · registro casi vacío |
| Tipos y formatos | tipo inconsistente · formato inválido (correo, fecha imposible como 31/02) · etiqueta inconsistente (`Bogota`/`BOGOTÁ`) · espacios sobrantes · tipos mezclados |
| Rangos | fuera de rango (IQR sobre la distribución real, en log si hay sesgo) · negativo · edad imposible · fecha futura |
| Relaciones | descubre sola cantidad×precio=subtotal, sumas (subtotal+impuesto=total), `emisión ≤ vencimiento`, `mínimo ≤ máximo`; solo se aceptan si ≥ 80 % de filas las cumplen; marca las que no |
| Sospechosos | montos pegados bajo un umbral (p. ej. 9 990 000 vs. tope 10 000 000) · redondeos · desviación de Benford |
| IA | anomalía multivariante con explicación en español («el valor X en «campo» está N desviaciones…» / «la combinación no es coherente…») |

Riesgo: puntaje 0–100 → bajo < 35 · medio < 60 · alto < 80 · crítico ≥ 80. El riesgo de un registro combina sus hallazgos (*noisy-OR*).

### Aprender de datos históricos
1. Analiza un archivo histórico → **«Guardar como línea base»** (envía solo la matriz numérica al backend → IA entrena un Isolation Forest).
2. En el siguiente archivo elige *Inteligencia artificial → Aprender de datos históricos* y la línea base. El frontend envía solo las características del archivo nuevo; la IA devuelve puntajes y el motor los convierte en hallazgos.
3. Si la IA o el backend no responden, el motor **cae solo al modelo local** y lo avisa.

## Resultados medidos (Chromium real)

`npm run verify:browser`, **Chromium headless con 2 núcleos lógicos** (entorno de pruebas de la sesión de desarrollo), facturas CSV sintéticas, IA local activa, 1 repetición por celda. *Tu equipo con más núcleos mostrará más ganancia; corre el comando en tu máquina para tus números.*

| Registros (MB) | Hilo principal | 1 worker | 2 workers | Pausa más larga de la UI (principal → 1 worker → 2 workers) |
|---|---|---|---|---|
| 50 000 (7,4 MB) | 2,6 s | 2,7 s | **2,2 s** | **2 570 ms** → 26 ms → 17 ms |
| 200 000 (29,4 MB) | 7,4 s | 8,6 s | **5,8 s** | **7 346 ms** → 83 ms → 67 ms |
| 500 000 (73,6 MB) | 18,8 s | 20,2 s | **12,8 s** | **18 703 ms** → 497 ms → 467 ms |

Lectura honesta:
* **Fluidez**: en hilo principal la página queda **congelada todo el análisis** (0 fps, pausa = duración completa). Con workers se mantiene en **~59 fps** y la pausa más larga es de decenas de ms. Esta es la mejora grande y constante.
* **Velocidad**: con 2 núcleos, 2 workers ganan **~1,3×–1,5×** frente al hilo principal. Un solo worker es algo *más lento* que el hilo principal (cuesta copiar mensajes) pero no congela nada. Las fases de entrenamiento y de mezcla final no se paralelizan.
* La pausa de ~470 ms con 500 000 registros viene de la fase RESOLVE (mezcla final) que corre en el hilo principal. Mejora pendiente: moverla a un worker (ver `AI_CONTEXT.md`).
* Los tres modos devolvieron **hallazgos idénticos** (mismo hash) en los tres tamaños.

Calidad de detección en datos sintéticos con anomalías sembradas (30 000 facturas): duplicados exactos/por clave/casi idénticos, faltantes, tipos, fechas imposibles, negativos, relaciones imposibles, etiquetas y espacios: **25/25**; fuera de rango 24/25; montos bajo umbral 145/145; la IA recupera 200/200 de los registros multivariantes sembrados con ~75 % de precisión. Sobre filas *no* sembradas, las reglas generan < 0,2 % de falsos positivos; la IA marca ≈ 1 % por diseño (su presupuesto de contaminación). **Son datos sintéticos: no hay validación con datos reales.**

## Estructura

```
src/
├── app/                 Next.js (layout, páginas, estilos)
├── components/          Analyzer, ReportTable (virtualizada), LiveMeter, BenchmarkView, BaselinePanel, RecordDrawer…
├── lib/                 api.ts (cliente del backend) · runner.ts (modos y pool) · frameMonitor.ts · pdfjsLoader.ts
├── workers/shard.worker.ts
└── engine/              Motor sin dependencias de navegador
    ├── parsers/ (csv, json, pdf) · profile/ · sketch/ (ddsketch, kmv) · detectors/ · ml/ (isolationForest, coherence, explain)
    ├── pipeline/ (coordinator, shardEngine, pool, planner, ingest, messages) · i18n/es.ts · synth.ts (datos de ejemplo con verdad conocida)
scripts/                 browser-verify.mjs · verify/harness-entry.ts · copy-pdf-worker.mjs · make-pdf-fixture.py
tests/                   util, csv, pipeline (recall/precisión/determinismo), pdf (+ fixtures)
docs/CONTRACT.md         contrato entre los 3 repos
```

## Qué está hecho y qué no

| Estado | Elemento |
|---|---|
| ✅ **Verificado** (39 pruebas ejecutadas; `tsc` sin errores en motor, workers y lib) | Motor completo, parsers CSV/TSV/JSON/NDJSON/PDF, detectores, IA local, determinismo 1–4 workers, exportación CSV/JSON |
| ✅ **Verificado en Chromium real** | Web Workers, pdf.js (PDF de 2 páginas), cancelación, mismos hallazgos en los 3 modos, medición Hilo principal vs Workers |
| ⚠️ **Escrito y tipado, pero no ejecutado** (en el entorno de creación no se podía instalar `next`/`react`: el registro de npm estaba bloqueado) | Toda la capa Next.js: `src/app/*`, `src/components/*`, `src/lib/api.ts`, `runner.ts`, `next.config.mjs`, `Dockerfile`, CI |
| ⚠️ **Riesgos conocidos al primer `npm run build`** | (1) `new Worker(new URL(...))` + `import('pdfjs-dist')` dentro del worker con webpack (si falla, usar `pdfjs-dist/legacy/build/pdf.mjs`); (2) tipos de React/Next (solo se comprobó contra *stubs*); (3) conexión `socket.io` y SSR contra el backend real |
| ❌ **No hecho** | Autenticación de usuarios, OCR para PDF escaneados, PDF sin tablas complejas (celdas combinadas), pruebas E2E de la UI, i18n a otros idiomas, métricas con datos reales, mover RESOLVE a un worker |

El detalle para continuar está en **`AI_CONTEXT.md`**.

## Limitaciones conocidas
* PDF: solo texto seleccionable con columnas alineadas; sin OCR.
* JSON: se carga completo en memoria (límite de seguridad de 400 MB); CSV/NDJSON se leen por bloques.
* Archivos de varios cientos de MB dependen de la memoria del navegador (las columnas se guardan en el worker).
* Excel (`.xlsx`) no está soportado todavía: expórtalo a CSV.
* La ganancia de velocidad depende de los núcleos reales; el hilo principal sirve de comparación, no de modo recomendado.

## Despliegue (más adelante)
* **Vercel / Netlify**: importa el repo; variables `NEXT_PUBLIC_API_URL` (URL pública del backend + `/api/v1`) y `API_URL` (la misma, usada por SSR). El script `build` copia el worker de pdf.js a `public/`.
* **Docker**: `Dockerfile` multi-etapa con `output: 'standalone'` (usa `--build-arg NEXT_PUBLIC_API_URL=…`).
* En el backend define `CORS_ORIGINS` con el dominio del frontend.

## Nombre de repositorio sugerido
`docu-sentinel-frontend`

```bash
git init -b main && git add . && git commit -m "feat: avance inicial del frontend (motor + UI)"
git remote add origin git@github.com:<tu-usuario>/docu-sentinel-frontend.git && git push -u origin main
```

## Notas para una IA generadora de código
Lee **`AI_CONTEXT.md`** primero: dice qué está terminado, qué falta para el 100 %, las convenciones (código en inglés, textos al usuario en español), los comandos de verificación y las trampas conocidas.
