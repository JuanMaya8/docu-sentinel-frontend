# docu-sentinel-frontend

Interfaz y **motor de análisis** del proyecto *Motor Inteligente para Detectar Inconsistencias en Documentos*.
Es el repositorio principal del sistema (junto a `docu-sentinel-backend` y `docu-sentinel-ai`).

Sube un **CSV, TSV, JSON, NDJSON o PDF** (con tablas de texto) y obtén un reporte con **Registro · Tipo de anomalía · Nivel de riesgo · Campo afectado · Explicación**.
Todo el análisis corre **en el navegador, en Web Workers**: el archivo no se sube a ningún servidor.

> **Estado: v0.3.0 — funcional, verificado y listo para Vercel** (46 pruebas del motor, `next build`, Chromium real y
> E2E de 20 comprobaciones con backend + IA + PostgreSQL reales y cuentas). Despliegue: [`DEPLOY.md`](DEPLOY.md).

## Cómo ejecutarlo

Requisitos: **Node 18.18+** (recomendado 20). No hace falta tener el backend para analizar archivos; solo el historial y las líneas base lo usan.

```bash
npm install
cp .env.example .env.local        # ajusta NEXT_PUBLIC_API_URL si el backend no está en :3001
npm run dev                       # http://localhost:3000
```

Ejecuta `npm run dev` desde la carpeta `docu-sentinel-frontend`. Si en `http://localhost:3000` aparece una aplicación anterior aunque la terminal indique que este proyecto está listo, puede ser un *service worker* guardado por otro proyecto en el mismo origen. Debes limpiarlo en el mismo navegador y perfil donde ves el problema (por ejemplo, Chrome; limpiar el navegador integrado de VS Code no limpia Chrome). En Chrome abre las herramientas de desarrollador (`F12`) → **Application** → **Storage** → **Clear site data**, y luego recarga la página. Alternativamente, en la consola de esas herramientas puedes ejecutar:
```js
await Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()));
await Promise.all((await caches.keys()).map(key => caches.delete(key)));
```
Esto limpia datos locales de ese origen (`localhost`), no los archivos del proyecto. Los Web Workers de análisis corren dentro de la página y no sirven aplicaciones ni ocupan el puerto.

Si Next.js avisa que el puerto 3000 ya está ocupado, revisa qué proceso lo usa en PowerShell:
```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```
Solo si confirmas que el PID corresponde a un servidor antiguo, puedes detenerlo con `Stop-Process -Id <PID>`. Si Next.js inicia en otro puerto, usa la URL que indique la terminal.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo (copia antes el worker de pdf.js a `public/`) |
| `npm run build && npm start` | Build de producción y servidor |
| `npm test` | **41 pruebas** del motor (Node, sin navegador): parsers, detectores, determinismo, PDF, parámetros de la línea base |
| `npm run test:e2e` | **E2E con Playwright** contra la app real (`next start`) + backend + IA: analizar, filtrar, exportar, tema, guardar, línea base, `/reportes` en vivo. `E2E_BASE_URL=http://localhost:3000`; `E2E_SKIP_BACKEND=1` para solo la parte local |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:browser` | Verificación en **Chromium real** (Playwright + esbuild): Workers, PDF, cancelación y **benchmark Hilo principal vs Workers**. `SIZES=50000,200000,500000 REPS=2 npm run verify:browser`. La primera vez: `npx playwright install chromium` |
| `docker build -t docu-sentinel-frontend --build-arg NEXT_PUBLIC_API_URL=https://tu-backend/api/v1 .` | Imagen de producción (Next *standalone*) |

Rutas: `/` · `/analizar` · `/benchmark` · `/reportes` · `/reportes/[id]`.
Para probar sin archivos, en **Analizar** pulsa «Generar y analizar» (datos de ejemplo con anomalías conocidas).

### Demo rápida (sin backend ni archivos)
1. `npm install` y `npm run dev`, luego abre http://localhost:3000/analizar.
2. En «¿Sin archivo a la mano?» elige *Facturas (CSV)* y *50.000 filas*, y pulsa **Generar y analizar**.
3. Revisa el resumen y la tabla de hallazgos; haz clic en una fila para ver el detalle del registro.
   También puedes arrastrar tu propio `.csv`, `.json`, `.xlsx` o `.pdf`.

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

`npm run verify:browser`, **Chromium headless con 24 núcleos lógicos** (Windows, v0.2.0), facturas CSV sintéticas, IA local activa, 1 repetición por celda. *Corre el comando en tu máquina para tus números.*

| Registros | Hilo principal | 1 worker | 2 workers | Pausa más larga de la UI (principal → 1 worker → 2 workers) |
|---|---|---|---|---|
| 50 000 | 1,9 s | 2,4 s | **1,5 s** | **1 836 ms** → 30 ms → 18 ms |
| 200 000 | 5,6 s | 5,8 s | **3,5 s** | **5 536 ms** → 67 ms → 85 ms |
| 500 000 | 12,0 s | 14,9 s | **7,7 s** | **11 983 ms** → 176 ms → 200 ms |

Medición anterior (v0.1, 2 núcleos): 500 000 registros en 18,8 s / 20,2 s / 12,8 s con pausas de 18 703 → 497 → 467 ms.

Lectura honesta:
* **Fluidez**: en hilo principal la página queda **congelada todo el análisis** (0–2 fps, pausa = duración completa). Con workers se mantiene en **~160 fps** (monitor de 165 Hz) y la pausa más larga es de decenas de ms (≤ 200 ms con 500 000 filas). Esta es la mejora grande y constante.
* **Velocidad**: 2 workers ganan **~1,3×–1,6×** frente al hilo principal. Un solo worker es algo *más lento* que el hilo principal (cuesta copiar mensajes) pero no congela nada. Las fases de entrenamiento y de mezcla final no se paralelizan.
* La pausa de ~450–600 ms con 500 000 registros venía de la fase RESOLVE (sobre todo `resolveDuplicates`, ~600 ms en una
  sola tarea). Desde v0.2.0 RESOLVE **cede el hilo** (`scheduler.yield()` o `setTimeout`) cada 100 000 filas al resolver
  duplicados, entre pasos y cada 50 000 hallazgos, en los modos con workers: la pausa bajó a ~200 ms con el **mismo
  resultado** (hash idéntico). El resto viene de recibir mensajes grandes de los workers. El modo *Hilo principal* no cede, a propósito.
* Los tres modos devolvieron **hallazgos idénticos** (mismo hash) en los tres tamaños.

Calidad de detección en datos sintéticos con anomalías sembradas (30 000 facturas): duplicados exactos/por clave/casi idénticos, faltantes, tipos, fechas imposibles, negativos, relaciones imposibles, etiquetas y espacios: **25/25**; fuera de rango 24/25; montos bajo umbral 145/145; la IA recupera 200/200 de los registros multivariantes sembrados con ~75 % de precisión. Sobre filas *no* sembradas, las reglas generan < 0,2 % de falsos positivos; la IA marca ≈ 1 % por diseño (su presupuesto de contaminación). **Son datos sintéticos: no hay validación con datos reales.**

## Estructura

```
src/
├── app/                 Next.js (layout, páginas, estilos)
├── components/          Analyzer, ReportTable (virtualizada), LiveMeter, BenchmarkView, BaselinePanel, RecordDrawer, ThemeToggle…
├── lib/                 api.ts (cliente del backend) · runner.ts (modos y pool) · frameMonitor.ts · pdfjsLoader.ts
├── workers/shard.worker.ts
└── engine/              Motor sin dependencias de navegador
    ├── parsers/ (csv, json, pdf) · profile/ · sketch/ (ddsketch, kmv) · detectors/ · ml/ (isolationForest, coherence, explain)
    ├── pipeline/ (coordinator, shardEngine, pool, planner, ingest, messages) · i18n/es.ts · synth.ts (datos de ejemplo con verdad conocida)
scripts/                 browser-verify.mjs · e2e-smoke.mjs · verify/harness-entry.ts · copy-pdf-worker.mjs · make-pdf-fixture.py
tests/                   util, csv, pipeline (recall/precisión/determinismo), pdf (+ fixtures)
docs/CONTRACT.md         contrato entre los 3 repos
```

## Qué está hecho y qué no

| Estado | Elemento |
|---|---|
| ✅ **Verificado** (46 pruebas; `tsc` limpio; `next build` OK) | Motor completo, parsers CSV/TSV/JSON/NDJSON/PDF/**XLSX**, detectores, IA local, determinismo 1–4 workers, exportación CSV/JSON, capa Next.js (SSG/CSR/SSR) |
| ✅ **Verificado en Chromium real** (`verify:browser`) | Web Workers, pdf.js, cancelación, mismos hallazgos en los 3 modos, medición Hilo principal vs Workers |
| ✅ **Verificado E2E** (`test:e2e`, **20 comprobaciones**, servicios reales con cuentas y PostgreSQL) | Crear cuenta e ingresar, historial privado sin sesión, analizar, filtrar, cajón accesible (foco atrapado, Escape), exportar CSV, tema, **restaurar tras recargar (IndexedDB)**, **analizar .xlsx**, guardar en historial, entrenar línea base y reanalizar con ella, **reentrenar (versión 2)**, `/reportes` SSR «En vivo», descargar JSON con la sesión, salir |
| ✅ **Nuevo en v0.2.0** | Interruptor de tema (automático → claro → oscuro, sin destello al cargar); RESOLVE cede el hilo; la línea base se entrena con el `thresholdFloor`/`contamination` de la sensibilidad elegida (paridad con la IA) y se puntúa enviando `schemaSignature` |
| ✅ **Nuevo en v0.3.0** | Cuentas (`/ingresar`, menú de cuenta, token en `localStorage` + cookie `ds_token` para el SSR), lector `.xlsx` sin dependencias (en workers), reentrenar líneas base, restaurar el último análisis, descargas autenticadas CSV/JSON, socket.io por usuario, accesibilidad del cajón y de la tabla del registro, `vercel.json` |
| ❌ **No hecho** | OCR para PDF escaneados (Tesseract.js pesa ~10 MB y descarga modelos: queda como opción futura), PDF con celdas combinadas, `.xls` antiguo, i18n a otros idiomas, validación con datos reales de una organización |

El detalle para continuar está en **`AI_CONTEXT.md`**.

## Limitaciones conocidas
* PDF: solo texto seleccionable con columnas alineadas; sin OCR.
* JSON: se carga completo en memoria (límite de seguridad de 400 MB); CSV/NDJSON se leen por bloques.
* Archivos de varios cientos de MB dependen de la memoria del navegador (las columnas se guardan en el worker).
* Excel: se lee **la primera hoja** de `.xlsx`/`.xlsm` (valores cacheados de fórmulas, fechas por formato de celda); `.xls` (97-2003) no está soportado.
* La ganancia de velocidad depende de los núcleos reales; el hilo principal sirve de comparación, no de modo recomendado.

## Despliegue (Vercel)
* **Vercel**: ver [`DEPLOY.md`](DEPLOY.md). Importa el repo (`vercel.json` incluido); variables `NEXT_PUBLIC_API_URL` (URL pública del backend + `/api/v1`) y `API_URL` (la misma, usada por SSR). El script `build` copia el worker de pdf.js a `public/`.
* **Docker**: `Dockerfile` multi-etapa con `output: 'standalone'` (usa `--build-arg NEXT_PUBLIC_API_URL=…`).
* En el backend define `CORS_ORIGINS` con el dominio del frontend.


## Contexto técnico
**`AI_CONTEXT.md`** resume el estado del proyecto: dice qué está terminado, qué falta para el 100 %, las convenciones (código en inglés, textos al usuario en español), los comandos de verificación y las trampas conocidas.
