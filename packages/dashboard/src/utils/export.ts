/**
 * Dashboard export helpers — convert arbitrary tabular data into
 * CSV, Markdown or JSON and trigger a browser download.
 *
 * Every helper is browser-safe: it constructs a Blob and uses
 * URL.createObjectURL + a synthetic anchor click to prompt a download.
 */

/* ------------------------------------------------------------------ */
/*  Shared primitives                                                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function triggerDownload(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Delay revocation slightly so the download can start reliably.
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[hipp0:export] Download failed:', err);
  }
}

/** Flatten one level of nested objects using dot notation. */
function flattenRow(row: Row, prefix = ''): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    const k = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      out[k] = '';
    } else if (Array.isArray(value)) {
      out[k] = value
        .map((v) =>
          typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
        )
        .join('; ');
    } else if (typeof value === 'object') {
      // Recursively flatten for CSV friendliness.
      Object.assign(out, flattenRow(value as Row, k));
    } else {
      out[k] = value;
    }
  }
  return out;
}

function collectHeaders(rows: Row[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) set.add(key);
  }
  return Array.from(set);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function ensureExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

/* ------------------------------------------------------------------ */
/*  CSV                                                                */
/* ------------------------------------------------------------------ */

export function exportToCsv(data: unknown[], filename: string): void {
  const rows = (Array.isArray(data) ? data : []).map((r) =>
    flattenRow((r ?? {}) as Row),
  );
  const headers = collectHeaders(rows);

  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  // Prepend a BOM so Excel opens UTF-8 correctly.
  const content = `\uFEFF${lines.join('\r\n')}\r\n`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, ensureExtension(filename, 'csv'));
}

/* ------------------------------------------------------------------ */
/*  Markdown                                                           */
/* ------------------------------------------------------------------ */

function mdEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function exportToMarkdown(
  data: unknown[],
  filename: string,
  format: 'table' | 'list' = 'table',
): void {
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  let content = '';

  if (format === 'list') {
    const chunks: string[] = [];
    for (const row of rows) {
      const flat = flattenRow(row ?? {});
      const keys = Object.keys(flat);
      if (keys.length === 0) continue;
      const header =
        (flat['title'] as string) ||
        (flat['name'] as string) ||
        (flat['id'] as string) ||
        'item';
      chunks.push(`## ${mdEscape(header)}`);
      for (const k of keys) {
        if (k === 'title' || k === 'name') continue;
        chunks.push(`- **${k}**: ${mdEscape(flat[k])}`);
      }
      chunks.push('');
    }
    content = chunks.join('\n');
  } else {
    const flatRows = rows.map((r) => flattenRow((r ?? {}) as Row));
    const headers = collectHeaders(flatRows);
    if (headers.length === 0) {
      content = '_(no data)_\n';
    } else {
      const lines: string[] = [];
      lines.push(`| ${headers.join(' | ')} |`);
      lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
      for (const row of flatRows) {
        lines.push(
          `| ${headers.map((h) => mdEscape(row[h])).join(' | ')} |`,
        );
      }
      content = lines.join('\n') + '\n';
    }
  }

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  triggerDownload(blob, ensureExtension(filename, 'md'));
}

/* ------------------------------------------------------------------ */
/*  JSON                                                               */
/* ------------------------------------------------------------------ */

export function exportToJson(data: unknown[], filename: string): void {
  const content = JSON.stringify(data ?? [], null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
  triggerDownload(blob, ensureExtension(filename, 'json'));
}
