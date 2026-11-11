# Despliegue en Vercel

La guía completa (Render para backend + IA + PostgreSQL y Vercel para este frontend) está en
[`docu-sentinel-backend/DEPLOY.md`](https://github.com/JuanMaya8/docu-sentinel-backend/blob/main/DEPLOY.md).
Resumen para este repo:

1. Despliega primero el backend en Render y copia su URL (`https://<backend>.onrender.com`).
2. Vercel → **Add New → Project** → importa este repo. `vercel.json` ya fija `npm ci`, `npm run build` y la región
   `pdx1` (cerca de Render Oregon).
3. Variables de entorno (Production y Preview):

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<backend>.onrender.com/api/v1` |
   | `API_URL` | `https://<backend>.onrender.com/api/v1` |

4. **Deploy**. Luego, en Render, pon el dominio de Vercel en `CORS_ORIGINS` del backend.

Notas:
* `NEXT_PUBLIC_API_URL` se incrusta en el *build*: si cambia, hay que redesplegar.
* El build copia `pdf.worker.min.mjs` a `public/` (script `copy-pdf-worker.mjs`); no hay que subirlo al repo.
* `/reportes` se renderiza en el servidor (SSR) y reenvía la cookie de sesión `ds_token` como `Authorization: Bearer`.
  `maxDuration = 60` deja tiempo a que el backend gratuito de Render despierte.
* El análisis de archivos no depende del backend: funciona aunque Render esté dormido.
