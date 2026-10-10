-- Roomly -- DESTROY ALL DATA. Fresh start.
--
-- ############################################################
-- ##  THIS CANNOT BE UNDONE. There is no backup and no undo. ##
-- ##  Every expense, split, settlement, member and household ##
-- ##  in this project is deleted.                            ##
-- ############################################################
--
-- Deliberately NOT in supabase/migrations/. A migration is something you
-- replay onto a database to bring its SCHEMA up to date -- putting a TRUNCATE
-- in that folder means the next person (or the next you, on a new machine)
-- wipes production by running the migrations in order. This is a one-off
-- maintenance script and it lives where it can only be run on purpose.
--
-- The schema is untouched: tables, functions, policies, triggers and the 19
-- migrations all stay exactly as they are. Only rows go.
--
-- TRUNCATE rather than DELETE, on purpose: DELETE on `members` would fire the
-- members_owner_remains constraint trigger ("a household must always have at
-- least one active owner") partway through. TRUNCATE fires TRUNCATE triggers
-- only, so the wipe cannot trip an invariant that exists to protect a live
-- household.
--
-- Pure ASCII. No transaction wrapper. Verification at the end.


-- ---------------------  what you are about to destroy  ---------------------
-- Run JUST this block first if you want to see the damage before doing it.

select 'households' as table_name, count(*) as rows_now from households
union all select 'members',             count(*) from members
union all select 'expenses',            count(*) from expenses
union all select 'expense_splits',      count(*) from expense_splits
union all select 'settlements',         count(*) from settlements
order by rows_now desc;


-- ---------------------------  the wipe  ---------------------------
-- One statement, so ordering and foreign keys are Postgres's problem rather
-- than mine. CASCADE is belt-and-braces: every table that references another
-- is already named here.

truncate table
  audit_log,
  away_periods,
  categories,
  expense_splits,
  expense_templates,
  expenses,
  households,
  invites,
  join_requests,
  members,
  notification_reads,
  notifications,
  payment_methods,
  pending_changes,
  periods,
  push_tokens,
  recurring_expenses,
  recurring_postings,
  settlements
cascade;

-- Created by supabase/seed/demo_data.sql purely so that seed could be undone.
-- The rows it pointed at are gone, so the log is meaningless now.
drop table if exists demo_seed_log;


-- ---------------------------  verification  ---------------------------
-- Ordered so that anything left behind floats to the top. If the first row
-- reads 0, every table is empty.

select 'audit_log' as table_name, count(*) as rows_left from audit_log
union all select 'away_periods',        count(*) from away_periods
union all select 'categories',          count(*) from categories
union all select 'expense_splits',      count(*) from expense_splits
union all select 'expense_templates',   count(*) from expense_templates
union all select 'expenses',            count(*) from expenses
union all select 'households',          count(*) from households
union all select 'invites',             count(*) from invites
union all select 'join_requests',       count(*) from join_requests
union all select 'members',             count(*) from members
union all select 'notification_reads',  count(*) from notification_reads
union all select 'notifications',       count(*) from notifications
union all select 'payment_methods',     count(*) from payment_methods
union all select 'pending_changes',     count(*) from pending_changes
union all select 'periods',             count(*) from periods
union all select 'push_tokens',         count(*) from push_tokens
union all select 'recurring_expenses',  count(*) from recurring_expenses
union all select 'recurring_postings',  count(*) from recurring_postings
union all select 'settlements',         count(*) from settlements
order by rows_left desc, table_name;


-- =====================  OPTIONAL: also delete the accounts  =====================
--
-- Everything above clears the APP. It does not touch Supabase Auth, so your
-- login still works -- you sign in, the app finds no member row, and takes you
-- to onboarding to create the household again. That is usually what you want.
--
-- Run this block ONLY if you also want everyone to register from scratch. One
-- reason you might: the reset-password bug that was fixed today was silently
-- changing your password every time you signed in, so nobody can be sure what
-- the current password is. Wiping the accounts removes that doubt.
--
-- delete from auth.users;
