import { requireOptionalNativeModule } from 'expo';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { csvAmount, toCsv } from '@/lib/csv';
import { formatRange } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import type { HistoryFilters } from '@/lib/history-filters';
import { formatPaise } from '@/lib/money';
import { supabase } from '@/lib/supabase';

/**
 * History's statement: every expense matching History's filters, as a
 * spreadsheet or a PDF, saved into the phone's Downloads (or, on an older
 * APK, handed to the share sheet).
 *
 * Fetched here rather than taken from the screen. With no date range History
 * loads only the newest 200, so a statement built from what is on screen would
 * silently stop a few months back while its total looked complete. This reads
 * every matching row, a page at a time, past the server's 1,000-row cap.
 */

export type StatementFormat = 'csv' | 'pdf';

/** Where a statement went: saved into Downloads, or handed to the share sheet. */
export type StatementResult =
  | { ok: true; rows: number; saved: { uri: string; name: string; mimeType: string } | null }
  | { ok: false; reason: string };

type DownloadsModule = {
  save(source: string, name: string, mimeType: string): Promise<string | null>;
  open(uri: string, mimeType: string): boolean;
};

/**
 * The local module in modules/downloads. Missing on APKs built before it was
 * added, and it returns null below Android 10; either way the statement goes
 * to the share sheet as before.
 */
const Downloads = requireOptionalNativeModule<DownloadsModule>('RoomlyDownloads');

/** Opens a statement saved into Downloads. False when no app can show it. */
export function openDownload(uri: string, mimeType: string): boolean {
  return Downloads?.open(uri, mimeType) ?? false;
}

type StatementRow = {
  date: string;
  description: string;
  category: string;
  paidBy: string;
  ways: number;
  totalPaise: number;
  /** Your part of it; 0 when you were not in the split. */
  myPaise: number;
};

/** What the statement covers, in words, for its header and filename. */
export type StatementScope = {
  householdName: string;
  myName: string;
  myId: string;
  filters: HistoryFilters;
  /** History's search text, applied as it is on screen. */
  search: string;
  /** e.g. "Groceries, Milk · paid by Lee"; empty when unfiltered. */
  summary: string;
};

/**
 * Whether this build can make a PDF.
 *
 * expo-print is a native module, so APKs built before it was added do not
 * have it -- and an EAS update reaches them. There the PDF choice says it
 * needs the latest app instead of crashing.
 */
export function canMakePdf(): boolean {
  return requireOptionalNativeModule('ExpoPrint') != null;
}

const PAGE = 1000;

async function fetchRows(scope: StatementScope): Promise<StatementRow[]> {
  const { filters } = scope;
  const out: StatementRow[] = [];

  for (let offset = 0; ; offset += PAGE) {
    let query = supabase
      .from('expenses')
      .select(
        `id, total_paise, description, expense_date, paid_by, category_id,
         categories ( name ),
         members!expenses_paid_by_fkey ( display_name ),
         expense_splits ( member_id, amount_paise )`
      )
      .is('voided_at', null);
    if (filters.from) query = query.gte('expense_date', filters.from);
    if (filters.to) query = query.lte('expense_date', filters.to);
    if (filters.categoryIds.length > 0) query = query.in('category_id', filters.categoryIds);
    if (filters.paidByIds.length > 0) query = query.in('paid_by', filters.paidByIds);

    const { data, error } = await query
      // Oldest first: a statement reads top to bottom through time.
      .order('expense_date', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;

    type Row = {
      total_paise: number;
      description: string | null;
      expense_date: string;
      categories: { name: string } | null;
      members: { display_name: string } | null;
      expense_splits: { member_id: string; amount_paise: number }[];
    };

    for (const e of data as unknown as Row[]) {
      out.push({
        date: e.expense_date,
        description: e.description ?? '',
        category: e.categories?.name ?? 'Uncategorised',
        paidBy: e.members?.display_name ?? '—',
        ways: e.expense_splits.length,
        totalPaise: Number(e.total_paise),
        myPaise: Number(e.expense_splits.find((s) => s.member_id === scope.myId)?.amount_paise ?? 0),
      });
    }
    if (data.length < PAGE) break;
  }

  // The search box filters on screen by description, category and payer, so
  // the statement does the same -- what you see is what you download.
  const needle = scope.search.trim().toLowerCase();
  return needle
    ? out.filter((r) => [r.description, r.category, r.paidBy].join(' ').toLowerCase().includes(needle))
    : out;
}

/** "1 Oct 2026 to 27 Oct 2026", or "All dates". */
function periodOf(filters: HistoryFilters): string {
  if (!filters.from && !filters.to) return 'All dates';
  return formatRange(filters.from ?? filters.to!, filters.to ?? filters.from);
}

function filenameOf(scope: StatementScope, ext: string): string {
  const slug = (v: string) =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `${slug(scope.householdName) || 'roomly'}-statement-${stamp}.${ext}`;
}

const CSV_HEADERS = ['Date', 'Description', 'Category', 'Paid by', 'Split ways', 'Amount', 'Your share'];

function toStatementCsv(rows: StatementRow[]): string {
  const total = rows.reduce((s, r) => s + r.totalPaise, 0);
  const mine = rows.reduce((s, r) => s + r.myPaise, 0);
  return toCsv(CSV_HEADERS, [
    ...rows.map((r) => [
      r.date,
      r.description || r.category,
      r.category,
      r.paidBy,
      r.ways,
      csvAmount(r.totalPaise),
      csvAmount(r.myPaise),
    ]),
    ['Total', '', '', '', '', csvAmount(total), csvAmount(mine)],
  ]);
}

/** Housemates type the descriptions, so everything is escaped into the HTML. */
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

function toStatementHtml(scope: StatementScope, rows: StatementRow[]): string {
  const total = rows.reduce((s, r) => s + r.totalPaise, 0);
  const mine = rows.reduce((s, r) => s + r.myPaise, 0);
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(dayOf(r.date))}</td>
        <td>${esc(r.description || r.category)}<div class="sub">${esc(r.category)}</div></td>
        <td>${esc(r.paidBy)}<div class="sub">${r.ways} way${r.ways === 1 ? '' : 's'}</div></td>
        <td class="num">${esc(formatPaise(r.totalPaise))}</td>
        <td class="num">${r.myPaise ? esc(formatPaise(r.myPaise)) : '—'}</td>
      </tr>`
    )
    .join('');

  // A4 with a 14mm margin, set by @page: on Android the margins option is
  // ignored and the page box comes from the WebView. Brand green for the rule
  // and the totals only; the table stays black on white so it prints well.
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
  <h1>${esc(scope.householdName)}</h1>
  <p class="meta">Statement · ${esc(periodOf(scope.filters))}</p>
  ${scope.summary ? `<p class="meta">${esc(scope.summary)}</p>` : ''}
  ${scope.search.trim() ? `<p class="meta">Matching “${esc(scope.search.trim())}”</p>` : ''}
  <div class="rule"></div>
  <div class="cards">
    <div class="card"><div class="label">Total spent</div><div class="value">${esc(formatPaise(total))}</div></div>
    <div class="card"><div class="label">${esc(scope.myName)}’s share</div><div class="value">${esc(formatPaise(mine))}</div></div>
    <div class="card"><div class="label">Expenses</div><div class="value">${rows.length}</div></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>What</th><th>Paid by</th><th class="num">Amount</th><th class="num">Your share</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${esc(formatPaise(total))}</td><td class="num">${esc(formatPaise(mine))}</td></tr></tfoot>
  </table>
  <p class="foot">Made with Roomly on ${esc(dayOf(new Date().toISOString().slice(0, 10)))}. Deleted expenses are not included.</p>
</body></html>`;
}

/** Into Downloads where the phone allows it, else the share sheet. */
async function deliver(
  file: FileSystem.File,
  rows: number,
  mimeType: string,
  UTI: string
): Promise<StatementResult> {
  const saved = Downloads ? await Downloads.save(file.uri, file.name, mimeType) : null;
  if (saved) return { ok: true, rows, saved: { uri: saved, name: file.name, mimeType } };

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: 'This device cannot share files.' };
  }
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: 'Statement' });
  return { ok: true, rows, saved: null };
}

export async function exportStatement(
  format: StatementFormat,
  scope: StatementScope
): Promise<StatementResult> {
  try {
    const rows = await fetchRows(scope);
    if (rows.length === 0) return { ok: false, reason: 'Nothing matches these filters.' };

    if (format === 'csv') {
      const file = new FileSystem.File(FileSystem.Paths.cache, filenameOf(scope, 'csv'));
      file.create({ overwrite: true });
      file.write(toStatementCsv(rows));
      return await deliver(file, rows.length, 'text/csv', 'public.comma-separated-values-text');
    }

    if (!canMakePdf()) {
      return { ok: false, reason: 'PDF needs the latest version of the app. The spreadsheet works now.' };
    }
    // Imported only here: on an APK without the native module, importing it
    // at the top of the file would throw as soon as History loaded.
    const Print = await import('expo-print');
    // A4 at 72 points per inch; the default is US Letter.
    const { uri } = await Print.printToFileAsync({ html: toStatementHtml(scope, rows), width: 595, height: 842 });

    // printToFileAsync names the file with a random id; give it a readable one
    // before it reaches Downloads or WhatsApp.
    const named = new FileSystem.File(FileSystem.Paths.cache, filenameOf(scope, 'pdf'));
    new FileSystem.File(uri).move(named, { overwrite: true });
    return await deliver(named, rows.length, 'application/pdf', 'com.adobe.pdf');
  } catch (e) {
    return { ok: false, reason: humanError(e) };
  }
}
