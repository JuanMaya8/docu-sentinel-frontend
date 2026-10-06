import type { FileFormat } from '../types';

export const MAX_JSON_BYTES = 400 * 1024 * 1024;

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase();
}

/** Decides the file format from extension + first bytes. */
export function detectFormat(fileName: string, head: Uint8Array): FileFormat {
  if (head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  const ext = extensionOf(fileName);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'tsv') return 'tsv';
  if (ext === 'ndjson' || ext === 'jsonl') return 'ndjson';
  const text = new TextDecoder('utf-8').decode(head.subarray(0, Math.min(head.length, 4096)));
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (ext === 'json' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    if (looksLikeNdjson(trimmed)) return 'ndjson';
    if (ext === 'csv' || ext === 'txt') return 'csv';
    return 'json';
  }
  return 'csv';
}

function looksLikeNdjson(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  // first line must be a complete JSON object and the second one must start another object
  try {
    const first = JSON.parse(lines[0]);
    return first !== null && typeof first === 'object' && !Array.isArray(first) && lines[1].trimStart().startsWith('{');
  } catch {
    return false;
  }
}

export function pickEncoding(head: Uint8Array): string {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

/** Streams a Blob as decoded text chunks. */
export async function readTextChunks(
  blob: Blob,
  encoding: string,
  onChunk: (text: string) => void,
  onBytes?: (bytes: number) => void,
): Promise<void> {
  const decoder = new TextDecoder(encoding);
  const reader = blob.stream().getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    onChunk(decoder.decode(value, { stream: true }));
    onBytes?.(bytes);
  }
  const tail = decoder.decode();
  if (tail.length > 0) onChunk(tail);
}

export async function readHead(blob: Blob, bytes = 262144): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, Math.min(blob.size, bytes)).arrayBuffer());
}
