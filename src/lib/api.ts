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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const key = process.env.NEXT_PUBLIC_API_KEY;
  if (key) headers['X-API-Key'] = key;
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
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
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const qs = (o: object): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request<{ status: string; ai: 'up' | 'down'; version: string }>('/health'),
  saveAnalysis: (dto: SaveAnalysisDto) => request<AnalysisSummary>('/analyses', { method: 'POST', body: JSON.stringify(dto) }),
  listAnalyses: (limit = 20, offset = 0) => request<Page<AnalysisSummary>>(`/analyses${qs({ limit, offset })}`),
  getAnalysis: (id: string) => request<AnalysisDetail>(`/analyses/${encodeURIComponent(id)}`),
  getFindings: (id: string, query: FindingsQuery = {}) => request<Page<Finding>>(`/analyses/${encodeURIComponent(id)}/findings${qs(query)}`),
  exportCsvUrl: (id: string) => `${apiBaseUrl()}/analyses/${encodeURIComponent(id)}/export.csv`,
  deleteAnalysis: (id: string) => request<void>(`/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listBaselines: () => request<BaselineDto[]>('/baselines'),
  createBaseline: (dto: { name: string; columns: string[]; kinds?: string[]; matrix: Array<Array<number | null>>; schemaSignature?: string; contamination?: number; seed?: number; thresholdFloor?: number }) =>
    request<BaselineDto>('/baselines', { method: 'POST', body: JSON.stringify(dto) }),
  deleteBaseline: (id: string) => request<void>(`/baselines/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  scoreBaseline: (id: string, matrix: Array<Array<number | null>>, topK = 3, schemaSignature?: string) =>
    request<AiScoreResponse>(`/baselines/${encodeURIComponent(id)}/score`, {
      method: 'POST',
      body: JSON.stringify({ matrix, explain: 'flagged', topK, ...(schemaSignature ? { schemaSignature } : {}) }),
    }),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
