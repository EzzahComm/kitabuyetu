/** Extracted from analytics.service.ts (Phase 10) so newsletter export can reuse it too. */

export function rowsToCsv(headers: string[], rows: Record<string, string | null>[]): string {
  const headerLine = headers.join(',');
  if (rows.length === 0) return headerLine + '\n';
  const dataLines = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','));
  return [headerLine, ...dataLines].join('\n') + '\n';
}

export function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvFilename(kind: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `kitabuyetu-${kind}-${today}.csv`;
}
