import * as FileSystem from 'expo-file-system';

import { csvAmount, toCsv } from '@/lib/csv';
import { daysInMonth, isoOf } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { formatPaise } from '@/lib/money';
import { personalCategory } from '@/lib/personal';
import { canMakePdf, deliver, type StatementFormat, type StatementResult } from '@/lib/statement';
import { supabase } from '@/lib/supabase';

/**
 * My ledger's statement: the private entries History shows -- one month or
 * every month, narrowed by its search -- as a PDF or a spreadsheet, saved into
 * Downloads like the house's statement (lib/statement).
 *
 * Read fresh here, a page at a time, rather than taken from the screen, which
 * holds only the newest few hundred.
 */

export type PersonalStatementScope = {
  /** First and last day, or both null for every month. Ignored when `months` is given. */
  from: string | null;
  to: string | null;
  /** Whole months, any number of them, in place of from and to. */
  months?: { year: number; month: number }[];
  /** "November 2026" or "All months", for the header. */
  periodLabel: string;
  search: string;
};

type Row = {
  date: string;
  description: string;
  category: string;
  note: string;
  amountPaise: number;
};

const PAGE = 1000;

async function fetchRows(scope: PersonalStatementScope): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = supabase
      .from('personal_expenses')
      .select('amount_paise, description, category, spent_on, note');
    if (scope.months?.length) {
      // One range per month, any of them: or=(and(gte,lte),and(gte,lte)).
      query = query.or(
        scope.months
          .map(
            ({ year, month }) =>
              `and(spent_on.gte.${isoOf(year, month, 1)},spent_on.lte.${isoOf(year, month, daysInMonth(year, month))})`
          )
          .join(',')
      );
    } else {
      if (scope.from) query = query.gte('spent_on', scope.from);
      if (scope.to) query = query.lte('spent_on', scope.to);
    }
    const { data, error } = await query
      // Oldest first: a statement reads top to bottom through time.
      .order('spent_on', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    type Raw = {
      amount_paise: number | string;
      description: string;
      category: string;
      spent_on: string;
      note: string | null;
    };
    for (const r of data as Raw[]) {
      out.push({
        date: r.spent_on,
        description: r.description,
        category: personalCategory(r.category).label,
        note: r.note ?? '',
        amountPaise: Number(r.amount_paise),
      });
    }
    if (data.length < PAGE) break;
  }
  // The same match as the search on screen: what you see is what you download.
  const needle = scope.search.trim().toLowerCase();
  return needle
    ? out.filter((r) =>
        [r.description, r.category, r.note].some((s) => s.toLowerCase().includes(needle))
      )
    : out;
}

function filenameOf(scope: PersonalStatementScope, ext: string): string {
  const slug = scope.periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `my-ledger-${slug || 'statement'}.${ext}`;
}

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dayOf(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function toCsvText(rows: Row[]): string {
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  return toCsv(
    ['Date', 'What for', 'Category', 'Note', 'Amount'],
    [
      ...rows.map((r) => [r.date, r.description, r.category, r.note, csvAmount(r.amountPaise)]),
      ['Total', '', '', '', csvAmount(total)],
    ]
  );
}

function toHtml(scope: PersonalStatementScope, rows: Row[]): string {
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amountPaise);
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(dayOf(r.date))}</td>
        <td>${esc(r.description)}${r.note ? `<div class="sub">${esc(r.note)}</div>` : ''}</td>
        <td>${esc(r.category)}</td>
        <td class="num">${esc(formatPaise(r.amountPaise))}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; color: #111; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { color: #555; margin: 0 0 2px; }
  .rule { height: 3px; background: #0E9A6C; margin: 12px 0 14px; border-radius: 2px; }
  .cards { display: flex; gap: 12px; margin-bottom: 14px; }
  .card { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; }
  .card .label { color: #555; font-size: 10px; }
  .card .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; color: #555; border-bottom: 1px solid #ccc; padding: 6px 4px; }
  td { border-bottom: 1px solid #eee; padding: 6px 4px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .sub { color: #777; font-size: 9px; margin-top: 1px; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #0E9A6C; border-bottom: none; }
  .foot { color: #888; font-size: 9px; margin-top: 14px; }
</style></head>
<body>
  <h1>My private ledger</h1>
  <p class="meta">Statement · ${esc(scope.periodLabel)}</p>
  ${scope.search.trim() ? `<p class="meta">Matching “${esc(scope.search.trim())}”</p>` : ''}
  <div class="rule"></div>
  <div class="cards">
    <div class="card"><div class="label">Total spent</div><div class="value">${esc(formatPaise(total))}</div></div>
    <div class="card"><div class="label">Payments</div><div class="value">${rows.length}</div></div>
    <div class="card"><div class="label">Most on</div><div class="value">${top ? esc(top[0]) : '—'}</div></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>What for</th><th>Category</th><th class="num">Amount</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${esc(formatPaise(total))}</td></tr></tfoot>
  </table>
  <p class="foot">Made with Roomly on ${esc(dayOf(new Date().toISOString().slice(0, 10)))}. Private: only you can see this ledger.</p>
</body></html>`;
}

export async function exportPersonalStatement(
  format: StatementFormat,
  scope: PersonalStatementScope
): Promise<StatementResult> {
  try {
    const rows = await fetchRows(scope);
    if (rows.length === 0) return { ok: false, reason: 'Nothing to put in this statement.' };

    if (format === 'csv') {
      const file = new FileSystem.File(FileSystem.Paths.cache, filenameOf(scope, 'csv'));
      file.create({ overwrite: true });
      file.write(toCsvText(rows));
      return await deliver(file, rows.length, 'text/csv', 'public.comma-separated-values-text');
    }

    if (!canMakePdf()) {
      return { ok: false, reason: 'PDF needs the latest version of the app. The spreadsheet works now.' };
    }
    const Print = await import('expo-print');
    const { uri } = await Print.printToFileAsync({ html: toHtml(scope, rows), width: 595, height: 842 });
    const named = new FileSystem.File(FileSystem.Paths.cache, filenameOf(scope, 'pdf'));
    new FileSystem.File(uri).move(named, { overwrite: true });
    return await deliver(named, rows.length, 'application/pdf', 'com.adobe.pdf');
  } catch (e) {
    return { ok: false, reason: humanError(e) };
  }
}
