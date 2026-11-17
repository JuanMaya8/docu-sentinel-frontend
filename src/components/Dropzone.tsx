'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Icon } from './Icon';

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
      <span className="dz-icon"><Icon name="upload" size={26} /></span>
      <strong>Arrastra tu archivo aquí o <span className="dz-link">haz clic para elegirlo</span></strong>
      <span className="muted small">Lee el archivo, perfila sus columnas y marca cada registro con problemas.</span>
      <span className="dz-formats" aria-label="Formatos aceptados">
        {['CSV', 'TSV', 'JSON', 'NDJSON', 'XLSX', 'PDF (tablas)'].map((f) => (<span key={f} className="tag">{f}</span>))}
      </span>
      <span className="chip ok dz-privacy"><Icon name="lock" size={12} /> Tu archivo se revisa en tu navegador · no se sube a ningún servidor</span>
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
