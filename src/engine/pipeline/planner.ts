/**
 * Shard planning: split a byte stream into N record-aligned ranges.
 * CSV is quote-aware: a newline inside a quoted field (RFC 4180 multiline field) is NOT a record boundary.
 * We work on raw bytes: 0x22 (") and 0x0A (\n) never appear inside a UTF-8 multibyte sequence.
 */
export interface ScanResult {
  headerEnd: number;
  boundaries: number[]; // absolute offsets of record starts, ascending (one per requested target)
  totalBytes: number;
}

export class BoundaryScanner {
  private pos = 0;
  private inQuotes = false;
  headerEnd = -1;
  private targets: number[] = [];
  private nextTarget = 0;
  readonly boundaries: number[] = [];

  constructor(
    private readonly quoteAware: boolean,
    private readonly totalBytes: number,
    private readonly shardCount: number,
    hasHeader = true,
  ) {
    if (!hasHeader) {
      this.headerEnd = 0;
      for (let k = 1; k < shardCount; k++) this.targets.push(Math.floor((totalBytes * k) / shardCount));
    }
  }

  push(chunk: Uint8Array): void {
    const n = chunk.length;
    for (let i = 0; i < n; i++) {
      const b = chunk[i];
      if (b === 0x22 && this.quoteAware) {
        this.inQuotes = !this.inQuotes;
      } else if (b === 0x0a && !this.inQuotes) {
        const next = this.pos + i + 1;
        if (this.headerEnd < 0) {
          this.headerEnd = next;
          this.targets = [];
          for (let k = 1; k < this.shardCount; k++) {
            this.targets.push(next + Math.floor(((this.totalBytes - next) * k) / this.shardCount));
          }
          this.nextTarget = 0;
        } else {
          while (this.nextTarget < this.targets.length && next >= this.targets[this.nextTarget]) {
            this.boundaries.push(next);
            this.nextTarget++;
          }
        }
      }
    }
    this.pos += n;
  }

  result(): ScanResult {
    return { headerEnd: this.headerEnd < 0 ? this.pos : this.headerEnd, boundaries: this.boundaries, totalBytes: this.pos };
  }
}

export function rangesFrom(scan: ScanResult): Array<{ start: number; end: number }> {
  const starts = [scan.headerEnd, ...scan.boundaries];
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : scan.totalBytes;
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

/** Reasonable shard count for a file: never create shards smaller than ~64 KB. */
export function effectiveShardCount(requested: number, totalBytes: number): number {
  return Math.max(1, Math.min(requested, Math.floor(totalBytes / 65536) || 1));
}
