/**
 * CSV encoding, done properly.
 *
 * This looks like a job for `rows.map(r => r.join(','))`, and that is wrong the
 * first time somebody writes an expense called "Milk, 2L" -- the row gains a
 * column and every field after it shifts. A backup that silently corrupts
 * itself on ordinary input is worse than no backup.
 *
 * Three things this handles that a join(',') does not:
 *
 *   1. Quoting. A field containing a comma, a double quote, or a newline is
 *      wrapped in quotes, and inner quotes are doubled (RFC 4180).
 *   2. Formula injection. A field starting with = + - @ is executed by Excel
 *      and Sheets when the file is opened. Descriptions here are typed by
 *      housemates, so they are untrusted input, and this is a real path from
 *      "name an expense" to "run something on someone's laptop".
 *   3. A UTF-8 byte order mark. Without it Excel reads the file as the local
 *      codepage and every rupee sign and non-ASCII name arrives as mojibake --
 *      the same class of failure that hit the category icons in migration 0010.
 */

/** Excel and Sheets treat these leading characters as the start of a formula. */
const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'];

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  // Neutralise before quoting: a leading apostrophe makes the cell literal
  // text in every spreadsheet, and survives the quoting below untouched.
  if (FORMULA_STARTERS.some((c) => text.startsWith(c))) {
    text = "'" + text;
  }

  const mustQuote =
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text !== text.trim();

  if (!mustQuote) return text;

  return '"' + text.replace(/"/g, '""') + '"';
}

export type CsvOptions = {
  /** Prepend a UTF-8 BOM so Excel does not mangle non-ASCII. Default true. */
  bom?: boolean;
};

export function toCsv(
  headers: string[],
  rows: readonly unknown[][],
  options: CsvOptions = {}
): string {
  const { bom = true } = options;

  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));

  // CRLF, because that is what RFC 4180 says and what Excel on Windows expects.
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/**
 * Paise to a plain decimal string for a spreadsheet cell.
 *
 * Deliberately not formatPaise(): that produces "Rs 1,234.00", and a thousands
 * separator inside a numeric column turns the value into text that no
 * spreadsheet will sum.
 */
export function csvAmount(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** A filename that sorts chronologically and is safe on every platform. */
export function backupFilename(householdName: string, now: Date): string {
  const slug =
    householdName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'roomly';

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');

  return `roomly-${slug}-${stamp}.csv`;
}
