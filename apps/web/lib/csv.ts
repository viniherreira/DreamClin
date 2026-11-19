/**
 * Planilha CSV para o Excel em português (`;`, BOM, quebra do Windows), com a
 * proteção contra fórmula. Mesma regra do `crm/csv.ts`, aqui para a gestão da
 * clínica, que não importa nada do CRM.
 */

export type CsvCell = string | number | null | undefined;

const BOM = '﻿';

export function csvCell(v: CsvCell, sep = ';'): string {
  if (v === null || v === undefined) return '';
  let t = typeof v === 'number' ? String(v).replace('.', ',') : v;
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /["\r\n]/.test(t) || t.includes(sep) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(header: string[], rows: CsvCell[][], sep = ';'): string {
  const linha = (cells: CsvCell[]) => cells.map((c) => csvCell(c, sep)).join(sep);
  return BOM + [linha(header), ...rows.map(linha)].join('\r\n') + '\r\n';
}
