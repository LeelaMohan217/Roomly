-- Roomly -- reproduce the app's CSV export from the database.
--
-- Read-only. Changes nothing.
--
-- The app's backup runs through src/lib/backup.ts and src/lib/csv.ts. This is
-- the same query shape, so if the two disagree the export is wrong -- and an
-- export you have not compared against the source is not a backup, it is a file.
--
-- HOW TO USE IT
--
--   1. In the app: Account > YOUR DATA > Export a backup. Save the CSV.
--   2. Run block 1 below. It tells you how many data rows to expect.
--   3. Open the CSV. Rows = lines - 1 (the header). They must match.
--   4. Run block 2 and spot-check a few rows against the file.
--
-- WHAT WILL LEGITIMATELY DIFFER
--
--   * Order. The app orders expenses and settlements separately and writes all
--     expenses first; this query interleaves them by date. Same rows.
--   * A leading apostrophe in the CSV on any description starting with
--     = + - @. That is deliberate -- see csv.ts. It is not corruption.
--   * Quoting around any field containing a comma or a quote mark.
--
-- Pure ASCII.


-- ------------------------  block 1: how many rows  ------------------------
-- One row per SPLIT, not per expense -- that is what the export writes.

select
  (select count(*) from expense_splits s
     join expenses e on e.id = s.expense_id)  as expense_rows,
  (select count(*) from settlements)          as settlement_rows,
  (select count(*) from expense_splits s
     join expenses e on e.id = s.expense_id)
  + (select count(*) from settlements)        as total_data_rows,
  (select count(*) from expenses)             as expenses_for_reference,
  (select count(*) from expenses where voided_at is not null) as of_which_deleted;


-- ------------------------  block 2: the rows themselves  ------------------
-- Same eleven columns, same order, same values as the CSV.

select
  'expense'                                              as type,
  e.expense_date::text                                   as date,
  coalesce(c.name, '')                                   as category,
  coalesce(e.description, '')                            as description,
  coalesce(payer.display_name, '')                       as paid_by,
  coalesce(owed.display_name, '')                        as owed_by,
  to_char(s.amount_paise / 100.0, 'FM999999990.00')      as amount,
  to_char(e.total_paise / 100.0, 'FM999999990.00')       as expense_total,
  case when e.voided_at is not null then 'deleted' else 'active' end as status,
  coalesce(creator.display_name, '')                     as recorded_by,
  e.id::text                                             as id
from expenses e
join expense_splits s     on s.expense_id = e.id
left join categories c    on c.id = e.category_id
left join members payer   on payer.id   = e.paid_by
left join members owed    on owed.id    = s.member_id
left join members creator on creator.id = e.created_by

union all

select
  'settlement',
  t.settled_on::text,
  '',
  coalesce(t.note, ''),
  coalesce(f.display_name, ''),
  coalesce(p.display_name, ''),
  to_char(t.amount_paise / 100.0, 'FM999999990.00'),
  '',
  case
    when t.voided_at is not null   then 'rejected'
    when t.confirmed_at is not null then 'confirmed'
    else 'awaiting confirmation'
  end,
  coalesce(r.display_name, ''),
  t.id::text
from settlements t
left join members f on f.id = t.from_member
left join members p on p.id = t.to_member
left join members r on r.id = t.created_by

order by date, type, id;


-- ------------------  block 3: does the file still balance  ----------------
-- The reason the export contains splits rather than expense totals: these two
-- numbers are what every balance is derived from. If they are not equal, the
-- export could not reconstruct the ledger.

select
  (select coalesce(sum(total_paise), 0) from expenses where voided_at is null)
    as expense_totals,
  (select coalesce(sum(s.amount_paise), 0)
     from expense_splits s
     join expenses e on e.id = s.expense_id
    where e.voided_at is null)
    as sum_of_splits,
  (select coalesce(sum(total_paise), 0) from expenses where voided_at is null)
  = (select coalesce(sum(s.amount_paise), 0)
       from expense_splits s
       join expenses e on e.id = s.expense_id
      where e.voided_at is null)
    as splits_reconstruct_totals,
  (select count(*) = 0 from ledger_imbalance()) as ledger_balances;
