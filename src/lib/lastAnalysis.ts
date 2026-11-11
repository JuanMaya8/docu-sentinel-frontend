/**
 * Keeps the LAST report in IndexedDB so a reload does not lose it. Only the report (findings + metadata) is stored,
 * never the original file, so "original record" lookups are not available after a restore.
 * Every function fails silently (private mode, blocked storage, quota): this is a convenience, not a guarantee.
 */
import type { Report } from '@/engine';

const DB = 'docu-sentinel';
const STORE = 'last-analysis';
const KEY = 'last';
/** above this the copy is skipped (IndexedDB quotas vary; a 100 000-finding report is ~30 MB) */
const MAX_FINDINGS = 100_000;

export interface StoredAnalysis {
  savedAt: string;
  report: Report;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLastAnalysis(report: Report): Promise<boolean> {
  if (report.findings.length > MAX_FINDINGS) return false;
  try {
    const value: StoredAnalysis = { savedAt: new Date().toISOString(), report };
    await run('readwrite', (s) => s.put(value, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadLastAnalysis(): Promise<StoredAnalysis | null> {
  try {
    const v = await run<StoredAnalysis | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<StoredAnalysis | undefined>);
    return v && v.report && Array.isArray(v.report.findings) ? v : null;
  } catch {
    return null;
  }
}

export async function clearLastAnalysis(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* ignore */
  }
}
