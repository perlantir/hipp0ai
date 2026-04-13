import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import {
  exportToCsv,
  exportToJson,
  exportToMarkdown,
} from '../utils/export';

export interface ExportButtonProps {
  /** Array of rows to export. Evaluated on click so it always reflects
   * current filter state. */
  data: unknown[];
  /** Base filename (no extension). Defaults to `hipp0-export`. */
  filename?: string;
  /** Optional extra className for layout tweaks. */
  className?: string;
  /** Disable the button (e.g. while loading). */
  disabled?: boolean;
  /** Visual size variant. */
  size?: 'sm' | 'md';
}

export function ExportButton({
  data,
  filename = 'hipp0-export',
  className,
  disabled,
  size = 'sm',
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handle = (fn: () => void) => {
    try {
      fn();
    } finally {
      setOpen(false);
    }
  };

  const count = Array.isArray(data) ? data.length : 0;
  const buttonPad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={wrapperRef} className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || count === 0}
        className={`flex items-center gap-1.5 rounded-md border border-[var(--border-light)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${buttonPad}`}
        title={count === 0 ? 'No data to export' : `Export ${count} rows`}
      >
        <Download size={size === 'sm' ? 12 : 14} />
        Export
        <ChevronDown size={size === 'sm' ? 11 : 13} className="opacity-70" />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 z-40 min-w-[150px] rounded-md border shadow-lg py-1"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-light)',
          }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]"
            onClick={() => handle(() => exportToCsv(data, filename))}
          >
            Download CSV
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]"
            onClick={() => handle(() => exportToMarkdown(data, filename, 'table'))}
          >
            Download Markdown
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]"
            onClick={() => handle(() => exportToJson(data, filename))}
          >
            Download JSON
          </button>
        </div>
      )}
    </div>
  );
}

export default ExportButton;
