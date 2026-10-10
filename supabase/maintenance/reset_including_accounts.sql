-- Roomly -- DESTROY EVERYTHING, ACCOUNTS INCLUDED. Register from scratch.
--
-- ##################################################################
-- ##  THIS CANNOT BE UNDONE. No backup, no undo.                  ##
-- ##  Unlike reset_all_data.sql, this ALSO deletes the login       ##
-- ##  accounts. Nobody will be able to sign in afterwards --       ##
-- ##  everyone registers again, including you.                    ##
-- ##################################################################
--
-- Not a migration, deliberately: a TRUNCATE in supabase/migrations/ wipes live
-- data for whoever replays it next.
--
-- Why this exists as a separate file: reset_all_data.sql clears the `public`
-- schema only. Login accounts live in `auth.users`, a different schema, so they
-- survived -- which is why a phone with a saved session still opened straight
-- to "You're in". That was correct behaviour, not a cache bug: the account was
-- genuinely still there.
--
-- TRUNCATE for the app tables rather than DELETE, because it fires no row
-- triggers -- so members_owner_remains ("a household must always have at least
-- one active owner") cannot abort the wipe partway through, which is exactly
-- what blocked deleting the last member by hand.
--
-- Pure ASCII. No transaction wrapper. Verification at the end.


-- --------------------  what you are about to destroy  --------------------
-- Run just this block first if you want to see it before doing it.

select 'login accounts' as what, count(*) as rows_now from auth.users
union all select 'members',    count(*) from members
union all select 'households', count(*) from households
union all select 'expenses',   count(*) from expenses
order by rows_now desc;


-- ------------------------  1. the app data  ------------------------

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

-- Left behind by supabase/seed/demo_data.sql, and meaningless now.
drop table if exists demo_seed_log;


-- ------------------------  2. the accounts  ------------------------
-- Safe in this order, and in the other: members.user_id is ON DELETE SET NULL
-- and join_requests.user_id is ON DELETE CASCADE, so neither blocks this.
--
-- Deleting a user also invalidates their refresh tokens, so the session saved
-- on each phone stops working. The app will drop back to the sign-in screen.

delete from auth.users;


-- ---------------------------  verification  ---------------------------
-- Every column must read 0.

select
  (select count(*) from auth.users)      as login_accounts,
  (select count(*) from households)      as households,
  (select count(*) from members)         as members,
  (select count(*) from categories)      as categories,
  (select count(*) from expenses)        as expenses,
  (select count(*) from expense_splits)  as splits,
  (select count(*) from settlements)     as settlements,
  (select count(*) from periods)         as periods,
  (select count(*) from notifications)   as notifications,
  (select count(*) from push_tokens)     as push_tokens;


-- =========================  IF STEP 2 IS REFUSED  =========================
--
-- auth.users is owned by supabase_auth_admin. The SQL editor usually has
-- rights, but if step 2 fails with a permission error, delete the accounts
-- from the dashboard instead -- it is the same operation:
--
--   Authentication > Users > select each row > Delete user
--
-- The app tables are already cleared by step 1 either way.
