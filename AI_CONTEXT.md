# AI_CONTEXT — docu-sentinel-frontend

> Para la IA generadora de código que continuará este repo. Lee `README.md` (arquitectura y comandos) y `docs/CONTRACT.md` (contrato con backend e IA; idéntico en los 3 repos).
> Reglas del proyecto: **código, identificadores y commits en inglés; todo texto visible al usuario en español (es-CO)**.

## 00. Novedades v0.3.0 (leer primero)
* **XLSX**: `src/engine/parsers/xlsx.ts` (ZIP + `DecompressionStream('deflate-raw')` + XML por regex, porque `DOMParser`
  no existe en workers). Entra al pipeline como el PDF (el `plan` devuelve `rows`). Formato `'xlsx'` en `FileFormat` y en
  el backend. `scripts/xlsx-writer.mjs` genera libros de prueba (lo usan `tests/xlsx.test.ts` y el E2E).
* **Cuentas**: `src/lib/session.ts` (localStorage + cookie `ds_token`), `createApi(getToken)` en `src/lib/api.ts`,
  `src/lib/serverApi.ts` para server components (lee la cookie). `AccountMenu` se oculta si `/health` no trae
  `auth:true`. Un 401 `AUTH_REQUIRED` con token borra la sesión. Las exportaciones del historial se descargan con
  `api.downloadExport` (un enlace normal no llevaría el token).
* `src/lib/lastAnalysis.ts`: último reporte en IndexedDB; el Analyzer ofrece «Restaurar» (sin registro original).
* `BaselinePanel`: «Reentrenar con este archivo» si las columnas coinciden. `RecordDrawer`: foco atrapado y devuelto.
* Despliegue: `vercel.json`, `DEPLOY.md`; `maxDuration = 60` en `/reportes` por el arranque en frío de Render.

## 0. Actualización (v0.2.0)

Lo marcado como «NO ejecutado» abajo **ya se ejecutó y funciona** (Windows, Node 22, Chromium 24 núcleos):
`npm run typecheck` limpio · `npm test` → 41 OK · `npm run build` OK · `npm run verify:browser` OK ·
`npm run test:e2e` → 12/12 con backend (`node dist/main.js`) + IA (uvicorn) reales.

Nuevo en v0.2.0:
* `TrainingSample` lleva `contamination` y `thresholdFloor` de la sensibilidad; `BaselinePanel` los envía al backend
  (la IA Python ya soporta `threshold_floor`, escala log y coherencia → paridad del modelo).
* `BaselineRef.schemaSignature` + `api.scoreBaseline(id, matrix, topK, schemaSignature)` → el backend responde
  `422 SCHEMA_MISMATCH` si la línea base cambió de esquema (el coordinador cae al modelo local y lo avisa).
* RESOLVE (`coordinator.ts`) cede el hilo con `yieldToEventLoop()`: `resolveDuplicatesAsync` cada 100 000 filas, entre pasos y cada `RESOLVE_SLICE` hallazgos en
  modos `worker`/`pool` (no en `main`). Determinismo intacto.
* `components/ThemeToggle.tsx` (+ `THEME_BOOT_SCRIPT` en `<head>` del layout) usa los `data-theme` que ya existían en CSS.
* `scripts/e2e-smoke.mjs` (`npm run test:e2e`), con `CHROMIUM_PATH` opcional. **Ojo**: `NEXT_PUBLIC_API_URL` se fija en
  el *build*; para E2E contra otro puerto hay que reconstruir.

## 1. Dónde quedó el trabajo (histórico v0.1 — ≈ 70 % del repo)

| Área | Estado | Cómo se comprobó |
|---|---|---|
| Motor `src/engine/**` (parsers CSV/TSV/JSON/NDJSON/PDF, perfilado, sketches, 7 familias de detectores, Isolation Forest + coherencia, explicaciones es) | **Hecho y probado** | `npm test` → 39 pruebas, `tsc` limpio |
| Determinismo (resultado idéntico con 1–4 workers e inline) | **Hecho y probado** | `tests/pipeline.test.ts` + `verify:browser` (hash igual en 3 modos × 3 tamaños) |
| Workers reales, pdf.js, cancelación, benchmark Main vs Workers | **Hecho y probado en Chromium** | `npm run verify:browser` |
| UI Next.js (`src/app`, `src/components`), cliente API (`src/lib/api.ts`), runner de modos | **Escrito, tipado contra stubs, NO ejecutado** | En el entorno de creación `npm install` estaba bloqueado |
| Config de despliegue (`Dockerfile`, `next.config.mjs`, CI) | **Escrito, NO ejecutado** | — |

### Primeras cosas que hacer (en este orden)
1. `npm install && npm run typecheck && npm test` — debe quedar todo en verde. Corrige primero los tipos reales de React/Next (solo se comprobó con *stubs*).
2. `npm run build` — riesgos conocidos:
   * `new Worker(new URL('../workers/shard.worker.ts', import.meta.url))` en `src/lib/runner.ts`. Si webpack no empaqueta el worker, revisa que el literal esté intacto.
   * `import('pdfjs-dist')` en `src/lib/pdfjsLoader.ts` dentro del worker. Si falla, cambia a `pdfjs-dist/legacy/build/pdf.mjs`. `next.config.mjs` ya alias `canvas: false`.
   * `scripts/copy-pdf-worker.mjs` copia `pdf.worker.min.mjs` a `public/` (el loader lo pide a `${origin}/pdf.worker.min.mjs`).
3. `npm run dev` y probar a mano: `/analizar` → «Generar y analizar» en los 3 modos; mirar el medidor (el punto debe congelarse en *Hilo principal* y no en workers); abrir un hallazgo (cajón con el registro original); `/benchmark`.
4. Con backend e IA levantados: guardar en historial, ver `/reportes` (SSR) y el chip «En vivo», entrenar una línea base y reanalizar con ella.
5. `npm run verify:browser` en una máquina con más núcleos para actualizar la tabla de resultados del README.

## 2. Qué falta para llegar al 100 %

**Prioridad alta**
* [x] Pasar el punto 1–4 de arriba y corregir lo que falle.
* [x] ~~**Mover la fase RESOLVE a un worker**~~ → resuelto troceando con cesiones al event loop (`yieldToEventLoop`). (`coordinator.ts`, bloque RESOLVE: `resolveDuplicates`, `findings.sort`, conteos). Hoy congela ~450 ms con 500 000 filas. Alternativa: trocear con `scheduler.yield()`.
* [x] **Paridad con la IA Python** (hecho en v0.2.0 en los 3 repos) (`docu-sentinel-ai/app/engine.py`): el motor local usa (a) `thresholdFloor` por sensibilidad (0.65/0.60/0.55), (b) modelo de **coherencia** (Mahalanobis recortado, `src/engine/ml/coherence.ts`), (c) escala **log** para positivos asimétricos (`shouldLog`). La IA solo tiene robust-scale + IF + guarda de extrapolación. En modo línea base eso significa menos recall en relaciones rotas. Porta (a)–(c) a Python, agrega `threshold_floor` al contrato (`TrainRequest`, `DetectRequest`) en **los 3 repos** y pruebas.
* [x] Pruebas E2E de la UI (`npm run test:e2e`, Playwright contra `next start` con backend e IA reales).
* [ ] Accesibilidad: revisar con lector de pantalla la tabla virtualizada (`role=table`, `aria-rowindex`) y el cajón (foco atrapado).

**Prioridad media**
* [ ] `.xlsx` (usar `exceljs`/SheetJS en un worker y reutilizar el parser tabular).
* [ ] PDF escaneados: OCR opcional (Tesseract.js en worker) y tablas con celdas combinadas.
* [ ] Autenticación (el backend hoy usa `X-API-Key` opcional; `NEXT_PUBLIC_API_KEY` queda visible en el navegador → solo demos).
* [ ] Reentrenar/actualizar una línea base existente (hoy se crea nueva).
* [ ] Persistir en `IndexedDB` el último análisis para sobrevivir a recargas (el archivo original no se guarda).
* [x] Tema claro/oscuro con interruptor (`ThemeToggle`, automático/claro/oscuro, guardado en `localStorage`).

**Prioridad baja**
* [ ] Internacionalización (hoy solo es-CO; los textos del motor están centralizados en `src/engine/i18n/es.ts`).
* [ ] Validar con datos reales de una organización y ajustar umbrales (`THRESHOLD_FLOOR`, `CONTAMINATION` en `coordinator.ts`).

## 3. Mapa rápido del código
* `src/engine/pipeline/coordinator.ts` — `analyzeFile(pool, file, name, options, mode, hooks)` orquesta fases; **no** hace trabajo pesado salvo RESOLVE.
* `src/engine/pipeline/shardEngine.ts` — lo que corre en cada worker (`handle(type, payload)`): `plan`, `parse`, `stats`, `features`, `featureChunk`, `train`, `detect`, `record`, `ids`, `dispose`. Tipos de mensajes en `messages.ts` (`RequestMap`).
* `src/engine/pipeline/pool.ts` — `WorkerPool`: `InlinePool` (hilo principal / tests) y `WebWorkerPool` (workers reales con `createWorker` inyectado).
* `src/engine/detectors/*` — un archivo por familia; `context.ts` define `DetectContext` y `makeEmitter`.
* `src/engine/ml/*` — `features.ts` (convención `<campo>`, `<campo>__missing`, `<campo>__rarity` — **compartida con la IA**), `isolationForest.ts`, `coherence.ts`, `explain.ts`.
* `src/lib/runner.ts` — crea el pool según el modo (`main` | `worker` | `pool`) y conecta la línea base con el backend.
* `src/components/Analyzer.tsx` — pantalla principal; `ReportTable.tsx` — tabla virtualizada (alto de fila fijo 64 px).
* `src/engine/synth.ts` — generador de datos con **verdad conocida** (facturas, inventario, pedidos): úsalo para cualquier prueba nueva de recall.

## 4. Invariantes que no se deben romper
1. **Determinismo**: mismo archivo + mismas opciones ⇒ mismos hallazgos con cualquier número de workers. Índices de fila son **globales**; los sketches (DDSketch, KMV) se mezclan; `compareFindings` es un orden total. Si cambias un detector, corre `tests/pipeline.test.ts` (prueba «DETERMINISM») y `verify:browser`.
2. **El motor no importa nada del navegador ni de Next** (`src/engine` debe seguir corriendo en Node con `tsx`).
3. **El archivo original nunca sale del navegador.** Solo hallazgos y matrices numéricas van al backend.
4. **Contrato**: si cambias `Finding`, `SaveAnalysisDto`, `BaselineDto`, la convención de características o los eventos, actualiza `docs/CONTRACT.md` en los **tres** repos.
5. Textos al usuario en español con formato es-CO (`fmtNum` en `i18n/es.ts`: `1.234,5`).
6. Sin dependencias nuevas de UI/gráficos sin necesidad (todo es SVG/CSS propios).

## 5. Comandos de verificación
```bash
npm run typecheck
npm test                                  # 39 pruebas del motor (≈ 30 s)
npm run verify:browser                    # Chromium real; SIZES=… REPS=… para más tamaño/repeticiones
python scripts/make-pdf-fixture.py        # regenera tests/fixtures/facturas.pdf (necesita reportlab)
```

## 6. Trampas conocidas
* `tsconfig` incluye lib `DOM` pero **no** `WebWorker` (chocan); el worker usa casts (`self as unknown as …`).
* Las pruebas de PDF se saltan solas si `pdfjs-dist` no está instalado.
* El generador sintético siempre inyecta filas «pegadas al umbral» proporcionales a `anomalyRate`; las filas naturales en esa ventana también se marcan (a propósito) y por eso `suspicious_threshold` se excluye del conteo de falsos positivos en la prueba de precisión.
* `Float64Array` no se serializa a JSON con `NaN`: `BaselinePanel.toMatrix` convierte `NaN` → `null`.
* `socket.io` se conecta al **origen** del backend sin el prefijo `/api/v1` (`socketOrigin()` en `lib/api.ts`), namespace `/realtime`.
