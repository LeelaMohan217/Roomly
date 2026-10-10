import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { humanError } from '@/lib/errors';
import { backupFilename, csvAmount, toCsv } from '@/lib/csv';
import {
  PAIR_STATEMENT_HEADERS,
  pairStatementRows,
  type PairNet,
} from '@/lib/pairwise';
import { supabase } from '@/lib/supabase';

/**
 * The whole ledger as one CSV, for backup.
 *
 * Supabase's free tier has no point-in-time recovery, and this app is now the
 * only record of who owes whom. One accidental TRUNCATE -- and the maintenance
 * scripts in supabase/maintenance/ contain exactly that -- is unrecoverable.
 *
 * ONE FILE, NOT SEVERAL, and with a `type` column: a backup you can only
 * restore from if you kept all four parts is not a backup. Everything needed
 * to reconstruct every balance is in here, because balances are derived --
 * expenses, their splits, and confirmed settlements are the whole input.
 *
 * One row per SPLIT rather than per expense. A single expense row would have
 * to encode "who owes what" into a cell, and the split is the thing the ledger
 * actually stores. It also makes the file usable in a spreadsheet without any
 * unpacking: filter by member, sum the amount column, and you have their share.
 *
 * RLS scopes every query to the caller's household, so this cannot export
 * anyone else's data even by accident.
 */

export type BackupResult =
  | { ok: true; filename: string; rows: number }
  | { ok: false; reason: string };

const HEADERS = [
  'type',
  'date',
  'category',
  'description',
  'paid_by',
  'owed_by',
  'amount',
  'expense_total',
  'status',
  'recorded_by',
  'id',
];


/**
 * Write a CSV to the cache and hand it to the share sheet.
 *
 * The cache directory, not documents: these files exist to be handed straight
 * to WhatsApp or Drive, and leaving copies in app storage on a phone with 38MB
 * of app and no cleanup story is worse than losing them.
 */
async function shareCsv(
  filename: string,
  csv: string,
  dialogTitle: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const uri = new FileSystem.File(FileSystem.Paths.cache, filename);
  uri.create({ overwrite: true });
  uri.write(csv);

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: 'This device cannot share files.' };
  }

  await Sharing.shareAsync(uri.uri, {
    mimeType: 'text/csv',
    dialogTitle,
    UTI: 'public.comma-separated-values-text',
  });

  return { ok: true };
}

export async function exportBackup(householdName: string): Promise<BackupResult> {
  try {
    const [expenses, settlements] = await Promise.all([
      supabase
        .from('expenses')
        .select(
          `id, total_paise, description, expense_date, voided_at,
           categories ( name ),
           payer:members!expenses_paid_by_fkey ( display_name ),
           creator:members!expenses_created_by_fkey ( display_name ),
           expense_splits ( amount_paise, members ( display_name ) )`
        )
        .order('expense_date', { ascending: true }),

      supabase
        .from('settlements')
        .select(
          `id, amount_paise, settled_on, note, voided_at, confirmed_at,
           payer:members!settlements_from_member_fkey ( display_name ),
           payee:members!settlements_to_member_fkey ( display_name ),
           recorder:members!settlements_created_by_fkey ( display_name )`
        )
        .order('settled_on', { ascending: true }),
    ]);

    if (expenses.error) throw expenses.error;
    if (settlements.error) throw settlements.error;

    type ExpenseRow = {
      id: string;
      total_paise: number;
      description: string | null;
      expense_date: string;
      voided_at: string | null;
      categories: { name: string } | null;
      payer: { display_name: string } | null;
      creator: { display_name: string } | null;
      expense_splits: { amount_paise: number; members: { display_name: string } | null }[];
    };

    type SettlementRow = {
      id: string;
      amount_paise: number;
      settled_on: string;
      note: string | null;
      voided_at: string | null;
      confirmed_at: string | null;
      payer: { display_name: string } | null;
      payee: { display_name: string } | null;
      recorder: { display_name: string } | null;
    };

    const rows: unknown[][] = [];

    for (const e of expenses.data as unknown as ExpenseRow[]) {
      // Voided expenses are kept. A backup that drops what was deleted cannot
      // answer "why did my balance change last Tuesday".
      const status = e.voided_at ? 'deleted' : 'active';

      for (const s of e.expense_splits) {
        rows.push([
          'expense',
          e.expense_date,
          e.categories?.name ?? '',
          e.description ?? '',
          e.payer?.display_name ?? '',
          s.members?.display_name ?? '',
          csvAmount(Number(s.amount_paise)),
          csvAmount(Number(e.total_paise)),
          status,
          e.creator?.display_name ?? '',
          e.id,
        ]);
      }
    }

    for (const t of settlements.data as unknown as SettlementRow[]) {
      rows.push([
        'settlement',
        t.settled_on,
        '',
        t.note ?? '',
        t.payer?.display_name ?? '',
        t.payee?.display_name ?? '',
        csvAmount(Number(t.amount_paise)),
        '',
        t.voided_at ? 'rejected' : t.confirmed_at ? 'confirmed' : 'awaiting confirmation',
        t.recorder?.display_name ?? '',
        t.id,
      ]);
    }

    const filename = backupFilename(householdName, new Date());
    const shared = await shareCsv(filename, toCsv(HEADERS, rows), 'Save your roomly backup');
    if (!shared.ok) return shared;

    return { ok: true, filename, rows: rows.length };
  } catch (e) {
    // humanError, not the raw text. This lands straight in an Alert
    // (settings.tsx:49), and a Supabase failure here reads as a PostgREST
    // sentence about a relation the user has never heard of.
    return { ok: false, reason: humanError(e) };
  }
}

/**
 * One pair's whole story, as a CSV.
 *
 * The Settle screen can only ever show a number: "Vinod owes you Rs 107". This
 * is the proof behind it -- every expense the two of you shared, which of you
 * paid, what each of your shares was, and a running total that lands on that
 * number. It is the artefact you send to the group chat when somebody says
 * "since when?".
 *
 * The rows come from pairwiseNets(), so this file and the screen cannot
 * disagree: both read the same computed lines.
 *
 * toCsv handles the parts that are easy to get wrong and expensive to get
 * wrong -- RFC 4180 quoting for a description like "Milk, 2L", a UTF-8 BOM so
 * Excel does not mangle the rupee sign, and neutralising a leading = or + so a
 * housemate-typed description cannot execute when the file is opened.
 */
export async function exportPairStatement(
  pair: PairNet,
  myName: string,
  theirName: string
): Promise<BackupResult> {
  try {
    const rows = pairStatementRows(pair, myName, theirName, csvAmount);

    const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `roomly-${slug(myName) || 'me'}-${slug(theirName) || 'them'}.csv`;

    const shared = await shareCsv(
      filename,
      toCsv(PAIR_STATEMENT_HEADERS, rows),
      `${myName} and ${theirName}`
    );
    if (!shared.ok) return shared;

    return { ok: true, filename, rows: rows.length };
  } catch (e) {
    return { ok: false, reason: humanError(e) };
  }
}
