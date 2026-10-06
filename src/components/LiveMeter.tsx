'use client';

import { useEffect, useRef, useState } from 'react';
import { EMPTY_FRAME_STATS, FREEZE_MS, type FrameMonitor, type FrameStats } from '@/lib/frameMonitor';
import { fmtMs } from '@/lib/format';
import { fmtNum } from '@/engine';

/**
 * A dot orbiting a ring, moved by JavaScript on every animation frame (not by CSS), plus live FPS numbers.
 * When the main thread is blocked the dot literally stops: that is the visible proof of Main Thread vs Workers.
 */
export function LiveMeter({ monitor, active, stats: finalStats }: { monitor: FrameMonitor; active: boolean; stats?: FrameStats }) {
  const dot = useRef<HTMLElement>(null);
  const [stats, setStats] = useState<FrameStats>(finalStats ?? EMPTY_FRAME_STATS);

  useEffect(() => {
    if (!active) {
      if (finalStats) setStats(finalStats);
      return;
    }
    monitor.onFrame = (now) => {
      const a = (now / 900) * Math.PI * 2;
      if (dot.current) dot.current.style.transform = `translate(${Math.cos(a) * 31}px, ${Math.sin(a) * 31}px)`;
    };
    const id = window.setInterval(() => setStats(monitor.snapshot()), 200);
    return () => {
      window.clearInterval(id);
      monitor.onFrame = undefined;
    };
  }, [active, monitor, finalStats]);

  const frozen = stats.maxGapMs > FREEZE_MS;
  return (
    <div className="meter" aria-label="Medidor de fluidez de la interfaz">
      <div className={`heartbeat${frozen ? ' frozen' : ''}`} aria-hidden="true">
        <i ref={dot} />
      </div>
      <div className="kv">
        <div>
          <b>{fmtNum(stats.fps, 0)}</b>
          <span>cuadros/seg</span>
        </div>
        <div>
          <b style={{ color: frozen ? 'var(--critical)' : undefined }}>{fmtMs(stats.maxGapMs)}</b>
          <span>pausa más larga</span>
        </div>
        <div>
          <b>{stats.freezes}</b>
          <span>congelamientos (&gt;{FREEZE_MS} ms)</span>
        </div>
        <div>
          <b>{fmtMs(stats.frozenMs)}</b>
          <span>tiempo congelado</span>
        </div>
      </div>
    </div>
  );
}
