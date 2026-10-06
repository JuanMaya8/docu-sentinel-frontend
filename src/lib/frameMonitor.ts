/**
 * Measures how responsive the main thread is, using requestAnimationFrame gaps.
 * A healthy page produces a frame every ~16 ms. When the main thread is busy parsing, frames stop:
 * the biggest gap and the number of "freezes" (> FREEZE_MS) are what the benchmark reports.
 */
export const FREEZE_MS = 100;

export interface FrameStats {
  frames: number;
  elapsedMs: number;
  fps: number;
  /** biggest time between two consecutive frames */
  maxGapMs: number;
  /** number of gaps longer than FREEZE_MS */
  freezes: number;
  /** total time lost in freezes (sum of gap - 16.7 for gaps > FREEZE_MS) */
  frozenMs: number;
}

export const EMPTY_FRAME_STATS: FrameStats = { frames: 0, elapsedMs: 0, fps: 0, maxGapMs: 0, freezes: 0, frozenMs: 0 };

export class FrameMonitor {
  private raf = 0;
  private running = false;
  private t0 = 0;
  private last = 0;
  private frames = 0;
  private maxGap = 0;
  private freezes = 0;
  private frozen = 0;
  /** called on every frame with the current time (used to animate the "heartbeat") */
  onFrame?: (now: number) => void;

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    if (this.last > 0) {
      const gap = now - this.last;
      this.frames++;
      if (gap > this.maxGap) this.maxGap = gap;
      if (gap > FREEZE_MS) {
        this.freezes++;
        this.frozen += gap - 16.7;
      }
    }
    this.last = now;
    this.onFrame?.(now);
    this.raf = requestAnimationFrame(this.tick);
  };

  private readonly onVisibility = (): void => {
    this.last = 0; // a hidden tab pauses rAF: do not count that as a freeze
  };

  start(): void {
    this.stop();
    this.t0 = performance.now();
    this.last = 0;
    this.frames = 0;
    this.maxGap = 0;
    this.freezes = 0;
    this.frozen = 0;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): FrameStats {
    const s = this.snapshot();
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    return s;
  }

  /** Includes the time since the last frame, so a freeze that is still in progress is visible. */
  snapshot(): FrameStats {
    const now = performance.now();
    const elapsed = Math.max(1, now - this.t0);
    let maxGap = this.maxGap;
    let freezes = this.freezes;
    let frozen = this.frozen;
    if (this.running && this.last > 0) {
      const pending = now - this.last;
      if (pending > maxGap) maxGap = pending;
      if (pending > FREEZE_MS) {
        freezes += 1;
        frozen += pending - 16.7;
      }
    }
    return { frames: this.frames, elapsedMs: elapsed, fps: (this.frames / elapsed) * 1000, maxGapMs: maxGap, freezes, frozenMs: frozen };
  }
}
