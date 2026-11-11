'use client';

import { useRef, useState, type DragEvent } from 'react';

const ACCEPT = '.csv,.tsv,.txt,.json,.ndjson,.jsonl,.pdf,.xlsx,.xlsm';

export function Dropzone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  return (
    <label
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      style={disabled ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
    >
      <strong>Arrastra un archivo aquí o haz clic para elegirlo</strong>
      <span className="muted small">CSV, TSV, JSON, NDJSON o PDF con tablas · el archivo no sale de tu navegador</span>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}
