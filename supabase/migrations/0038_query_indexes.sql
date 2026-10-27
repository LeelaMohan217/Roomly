-- Roomly -- indexes for the queries the app actually runs.
--
-- Every table already has its primary key, and 0001 indexed the obvious
-- foreign keys. These are the shapes that were still read by scanning, taken
-- from src/lib/queries.ts and the functions behind member_balances. Each one
-- names the query it serves.
--
-- RLS adds `household_id = current_household()` to every read, so the list
-- indexes lead with household_id and then follow the screen's ORDER BY --
-- Postgres can then walk the index in order and stop at the LIMIT instead of
-- sorting the whole household's rows first.
--
-- Partial indexes (WHERE voided_at IS NULL, status = 'pending', ...) match the
-- filter the app always applies, so they stay small and only cover live rows.
--
-- A household's tables are small today, so the gain now is modest; it is the
-- difference between a screen that stays fast after a few years of expenses
-- and one that slows down month by month. member_balance() runs for every
-- member on every balance read, and is the one that matters most.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the SQL Editor runs a script in one
-- transaction, where CONCURRENTLY is refused. At this size each build takes
-- milliseconds, so the brief write lock is not noticeable.
--
-- IF NOT EXISTS throughout, so re-running is harmless. No begin/commit
-- wrapper, per 0011's header. Check the SELECT at the bottom.


-- ------------------------------- expenses -------------------------------

-- History, Home's Recent, date-range filters, the away calendar, the month
-- statement and the pairwise ledger: live expenses, newest first, optionally
-- within a date range.
create index if not exists expenses_live_by_date_idx
  on expenses (household_id, expense_date desc, created_at desc)
  where voided_at is null;

-- Add Expense's suggestions: the 60 newest live expenses with a description.
create index if not exists expenses_suggestions_idx
  on expenses (household_id, created_at desc)
  where voided_at is null and description is not null;

-- member_balance(): what each member paid. Replaces a lookup into
-- expenses_payer_idx followed by a heap fetch for every row's amount.
create index if not exists expenses_paid_by_total_idx
  on expenses (paid_by) include (total_paise)
  where voided_at is null;

-- Joins to categories (every expense list), the category delete check, and
-- monthly_category_totals.
create index if not exists expenses_category_idx on expenses (category_id);


-- ---------------------------- expense_splits ----------------------------

-- member_balance(): every share a member owes, joined to its expense. The
-- existing splits_member_idx finds the rows; including the two columns the
-- sum and join read lets it answer from the index alone.
create index if not exists splits_member_amount_idx
  on expense_splits (member_id) include (expense_id, amount_paise);


-- ------------------------------ settlements -----------------------------

-- Payment history: every settlement, newest first.
create index if not exists settlements_by_date_idx
  on settlements (household_id, settled_on desc, created_at desc);

-- member_balance(): confirmed, live payments made and received.
create index if not exists settlements_from_confirmed_idx
  on settlements (from_member) include (amount_paise)
  where voided_at is null and confirmed_at is not null;

create index if not exists settlements_to_confirmed_idx
  on settlements (to_member) include (amount_paise)
  where voided_at is null and confirmed_at is not null;

-- Closing and reopening a month look up its payments.
create index if not exists settlements_period_idx on settlements (period_id);


-- ------------------------- approvals and requests -----------------------

-- Home's "Needs you": pending edit and delete requests, oldest first.
create index if not exists pending_changes_open_idx
  on pending_changes (household_id, requested_at)
  where status = 'pending';

-- Owner tools and Home: pending join requests, oldest first.
create index if not exists join_requests_open_idx
  on join_requests (household_id, requested_at)
  where status = 'pending';

-- Sign-in: "is this account waiting to be let in?" is asked by user alone,
-- which join_one_pending_per_user (household_id, user_id) cannot answer.
create index if not exists join_requests_user_open_idx
  on join_requests (user_id)
  where status = 'pending';


-- -------------------------- activity and alerts -------------------------

-- Edit history: the newest entries for the household.
create index if not exists audit_household_recent_idx
  on audit_log (household_id, created_at desc);

-- The bell: which notifications this member has read. The primary key leads
-- with notification_id, so reading by member scanned the whole table.
create index if not exists notification_reads_member_idx
  on notification_reads (member_id);


-- ------------------------------ everything else -------------------------

-- The away calendar, newest trip first.
create index if not exists away_household_start_idx
  on away_periods (household_id, start_date desc);

-- Category pickers and lists, in their saved order.
create index if not exists categories_household_order_idx
  on categories (household_id, sort_order);


-- Fresh statistics, so the planner knows these indexes are worth using.
analyze expenses;
analyze expense_splits;
analyze settlements;
analyze pending_changes;
analyze join_requests;
analyze audit_log;
analyze notification_reads;
analyze away_periods;
analyze categories;


-- ---------------------------  verification  ---------------------------
-- Every column must read true. If any is false, this migration did not apply.

select
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'expenses_live_by_date_idx', 'expenses_suggestions_idx',
        'expenses_paid_by_total_idx', 'expenses_category_idx',
        'splits_member_amount_idx',
        'settlements_by_date_idx', 'settlements_from_confirmed_idx',
        'settlements_to_confirmed_idx', 'settlements_period_idx',
        'pending_changes_open_idx', 'join_requests_open_idx',
        'join_requests_user_open_idx',
        'audit_household_recent_idx', 'notification_reads_member_idx',
        'away_household_start_idx', 'categories_household_order_idx'
      )) = 16                                        as all_sixteen_indexes_exist,
  (select count(*) = 0 from pg_index i
     join pg_class c on c.oid = i.indexrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not i.indisvalid) as no_invalid_indexes,
  (select count(*) = 0 from ledger_imbalance())      as ledger_still_balances;
