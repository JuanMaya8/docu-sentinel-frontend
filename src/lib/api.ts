/**
 * Typed client for docu-sentinel-backend (see docs/CONTRACT.md). Works in the browser and in server components.
 *  - browser:  NEXT_PUBLIC_API_URL  (default http://localhost:3001/api/v1)
 *  - server:   API_URL (falls back to NEXT_PUBLIC_API_URL) — useful inside Docker (http://backend:3001/api/v1)
 */
import type { AnomalyType, ColumnSummary, FileFormat, Finding, MlMode, ProcessingMode, RiskLevel, Sensitivity } from '@/engine';
import { clearSession, getStoredToken, type SessionUser } from './session';

export interface AnalysisSummary {
  id: string;
  createdAt: string;
  fileName: string;
  format: FileFormat;
  fileSizeBytes: number;
  rows: number;
  columnCount: number;
  durationMs: number;
  mode: ProcessingMode;
  workers: number;
  findingsCount: number;
  recordsAffected: number;
  byRisk: Record<RiskLevel, number>;
  byType: Record<string, number>;
}
export interface AnalysisDetail extends AnalysisSummary {
  columns: ColumnSummary[];
  sensitivity: Sensitivity;
  mlMode: MlMode;
  baselineId?: string;
}
export interface SaveAnalysisDto {
  fileName: string;
  format: FileFormat;
  fileSizeBytes: number;
  rows: number;
  columns: ColumnSummary[];
  durationMs: number;
  mode: ProcessingMode;
  workers: number;
  sensitivity: Sensitivity;
  mlMode: MlMode;
  baselineId?: string;
  findings: Finding[];
}
export interface BaselineDto {
  id: string;
  name: string;
  aiModelId: string;
  columns: string[];
  kinds: string[];
  rows: number;
  threshold: number;
  trainedAt: string;
  schemaSignature?: string;
  thresholdFloor?: number;
  /** 1 on creation, +1 on each retrain */
  version?: number;
}
export interface HealthDto {
  status: string;
  ai: 'up' | 'down';
  version: string;
  /** true when the backend has user accounts (JWT_SECRET); then every report and baseline belongs to a user */
  auth?: boolean;
  store?: 'postgres' | 'files';
}
export interface AuthSessionDto {
  token: string;
  expiresAt: string;
  user: SessionUser & { createdAt?: string };
}
type Matrix = Array<Array<number | null>>;
export interface Page<T> {
  items: T[];
  total: number;
}
export interface FindingsQuery {
  risk?: RiskLevel;
  type?: AnomalyType;
  field?: string;
  q?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}
export interface AiScoreResponse {
  model_id: string;
  threshold: number;
  scores: number[];
  flags: boolean[];
  contributions: Record<string, Array<{ field: string; message: string; deviation: number; kind?: string; expected?: number | null }>>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_URL = 'http://localhost:3001/api/v1';

export function apiBaseUrl(): string {
  if (typeof window === 'undefined') return (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_URL).replace(/\/$/, '');
  return (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_URL).replace(/\/$/, '');
}

/** Origin for socket.io (the backend URL without the /api/v1 suffix). */
export function socketOrigin(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_URL).replace(/\/api\/v\d+\/?$/, '');
}

function headersFor(token: string | undefined, init: RequestInit): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const key = process.env.NEXT_PUBLIC_API_KEY;
  if (key) headers['X-API-Key'] = key;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function send(path: string, init: RequestInit, token: string | undefined): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers: headersFor(token, init), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'BACKEND_UNREACHABLE', 'No se pudo conectar con el backend. ¿Está encendido en ' + apiBaseUrl() + '?');
  }
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    let message = `El backend respondió ${res.status}`;
    try {
      const body = (await res.json()) as { code?: string; message?: string | string[] };
      if (body.code) code = body.code;
      if (body.message) message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    } catch {
      /* not JSON */
    }
    // an expired or revoked token: forget it so the UI asks to log in again
    if (res.status === 401 && token && typeof window !== 'undefined' && code === 'AUTH_REQUIRED') clearSession();
    throw new ApiError(res.status, code, message);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit, token: string | undefined): Promise<T> {
  const res = await send(path, init, token);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const qs = (o: object): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const id = (x: string): string => encodeURIComponent(x);

/**
 * `getToken` returns the session token to send (browser: localStorage; server components: the session cookie, see
 * src/lib/serverApi.ts). Without accounts on the backend it simply returns undefined.
 */
export function createApi(getToken: () => string | undefined = getStoredToken) {
  const r = <T,>(path: string, init: RequestInit = {}): Promise<T> => request<T>(path, init, getToken());
  const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
  return {
    health: () => r<HealthDto>('/health'),
    register: (dto: { email: string; password: string; name?: string }) => r<AuthSessionDto>('/auth/register', post(dto)),
    login: (dto: { email: string; password: string }) => r<AuthSessionDto>('/auth/login', post(dto)),
    me: () => r<SessionUser>('/auth/me'),
    saveAnalysis: (dto: SaveAnalysisDto) => r<AnalysisSummary>('/analyses', post(dto)),
    listAnalyses: (limit = 20, offset = 0) => r<Page<AnalysisSummary>>(`/analyses${qs({ limit, offset })}`),
    getAnalysis: (aid: string) => r<AnalysisDetail>(`/analyses/${id(aid)}`),
    getFindings: (aid: string, query: FindingsQuery = {}) => r<Page<Finding>>(`/analyses/${id(aid)}/findings${qs(query)}`),
    exportCsvUrl: (aid: string) => `${apiBaseUrl()}/analyses/${id(aid)}/export.csv`,
    exportJsonUrl: (aid: string) => `${apiBaseUrl()}/analyses/${id(aid)}/export.json`,
    /** Downloads an export with the session header (a plain link would not carry the token). Browser only. */
    downloadExport: async (aid: string, kind: 'csv' | 'json', fallbackName: string): Promise<void> => {
      const res = await send(`/analyses/${id(aid)}/export.${kind}`, {}, getToken());
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    deleteAnalysis: (aid: string) => r<void>(`/analyses/${id(aid)}`, { method: 'DELETE' }),
    listBaselines: () => r<BaselineDto[]>('/baselines'),
    createBaseline: (dto: { name: string; columns: string[]; kinds?: string[]; matrix: Matrix; schemaSignature?: string; contamination?: number; seed?: number; thresholdFloor?: number }) =>
      r<BaselineDto>('/baselines', post(dto)),
    retrainBaseline: (bid: string, dto: { matrix: Matrix; columns?: string[]; contamination?: number; thresholdFloor?: number }) =>
      r<BaselineDto>(`/baselines/${id(bid)}/retrain`, post(dto)),
    deleteBaseline: (bid: string) => r<void>(`/baselines/${id(bid)}`, { method: 'DELETE' }),
    scoreBaseline: (bid: string, matrix: Matrix, topK = 3, schemaSignature?: string) =>
      r<AiScoreResponse>(`/baselines/${id(bid)}/score`, post({ matrix, explain: 'flagged', topK, ...(schemaSignature ? { schemaSignature } : {}) })),
  };
}

/** Browser client (token from localStorage). Server components must use `serverApi()` instead. */
export const api = createApi();

export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
