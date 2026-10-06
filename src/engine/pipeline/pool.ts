import { ShardEngine, type ShardEngineOptions } from './shardEngine';
import type { ProgressMsg, RequestMap } from './messages';

export interface CallOptions {
  transfer?: Transferable[];
  onProgress?: (p: ProgressMsg) => void;
}

/** Anything that can run ShardEngine requests: real Web Workers, or in-process engines. */
export interface WorkerPool {
  readonly size: number;
  readonly kind: 'inline' | 'web-worker';
  call<K extends keyof RequestMap>(worker: number, type: K, payload: RequestMap[K][0], opts?: CallOptions): Promise<RequestMap[K][1]>;
  terminate(): void;
}

/**
 * Runs N engines in the CURRENT thread. Used for the "Main thread" benchmark mode (it really blocks the UI)
 * and for deterministic unit tests of the whole pipeline.
 */
export class InlinePool implements WorkerPool {
  readonly kind = 'inline' as const;
  private engines: ShardEngine[];
  constructor(readonly size: number, engineOptions: ShardEngineOptions = {}) {
    this.engines = Array.from({ length: size }, () => new ShardEngine(engineOptions));
  }
  async call<K extends keyof RequestMap>(worker: number, type: K, payload: RequestMap[K][0], opts?: CallOptions): Promise<RequestMap[K][1]> {
    return (await this.engines[worker].handle(type, payload, opts?.onProgress)) as RequestMap[K][1];
  }
  terminate(): void {
    this.engines = [];
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (p: ProgressMsg) => void;
}

/** Real Web Workers. `createWorker` is injected so this file does not depend on any bundler. */
export class WebWorkerPool implements WorkerPool {
  readonly kind = 'web-worker' as const;
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(readonly size: number, createWorker: () => Worker) {
    for (let i = 0; i < size; i++) {
      const w = createWorker();
      w.onmessage = (ev: MessageEvent) => this.onMessage(ev.data as WorkerReply);
      w.onerror = (ev: ErrorEvent) => this.failAll(new Error(ev.message || 'Error en el worker'));
      this.workers.push(w);
    }
  }

  private onMessage(msg: WorkerReply): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.kind === 'progress') {
      p.onProgress?.(msg.progress);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.kind === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  call<K extends keyof RequestMap>(worker: number, type: K, payload: RequestMap[K][0], opts?: CallOptions): Promise<RequestMap[K][1]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: opts?.onProgress });
      this.workers[worker].postMessage({ id, type, payload }, opts?.transfer ?? []);
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.failAll(new Error('Análisis cancelado'));
  }
}

export type WorkerReply =
  | { id: number; kind: 'result'; result: unknown }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'progress'; progress: ProgressMsg };

/** Wires a ShardEngine to a worker global scope. Used by src/workers/shard.worker.ts. */
export function attachEngineToWorkerScope(
  scope: { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent) => void) | null },
  engine: ShardEngine,
): void {
  scope.onmessage = async (ev: MessageEvent) => {
    const { id, type, payload } = ev.data as { id: number; type: string; payload: unknown };
    try {
      const result = await engine.handle(type, payload, (progress) => scope.postMessage({ id, kind: 'progress', progress } satisfies WorkerReply));
      scope.postMessage({ id, kind: 'result', result } satisfies WorkerReply, collectTransferables(result));
    } catch (e) {
      scope.postMessage({ id, kind: 'error', message: e instanceof Error ? e.message : String(e) } satisfies WorkerReply);
    }
  };
}

/** Typed arrays in results are transferred (zero-copy) instead of cloned. */
function collectTransferables(result: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 3 || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      out.push((v as ArrayBufferView).buffer as ArrayBuffer);
      return;
    }
    if (Array.isArray(v)) return; // do not walk big arrays (findings)
    for (const k of Object.keys(v as object)) visit((v as Record<string, unknown>)[k], depth + 1);
  };
  visit(result, 0);
  return out;
}
