-- Roomly -- clear the people and the money, keep the room and its categories.
--
-- ##########################################################
-- ##  THIS CANNOT BE UNDONE. No backup, no undo.           ##
-- ##########################################################
--
-- Not a migration, deliberately: a DELETE in supabase/migrations/ wipes live
-- data for whoever replays it next. Kept here so it can only run on purpose.
--
--
-- WHY THIS SCRIPT EXISTS RATHER THAN "keep only categories"
--
-- categories.household_id is NOT NULL REFERENCES households(id)
-- ON DELETE CASCADE. Categories belong TO a household -- they are not a global
-- list -- so there is no way to drop the household and keep its categories.
--
-- That is fine, because create_household() seeds the same 13 categories every
-- time. So there are only two sane options:
--
--   1. supabase/maintenance/reset_all_data.sql
--      Wipes everything including the household. You sign in, land on
--      onboarding, create the room again, and the 13 categories come back
--      automatically. Nothing is lost.
--
--   2. THIS FILE
--      Keeps the household, its categories, its payment methods and YOU as
--      owner. Deletes every other member and every rupee ever recorded. You
--      sign in and are straight back in the app with a clean ledger and no
--      onboarding.
--
-- Use this one if you do not want to re-create the room. Use the other if you
-- want a genuinely blank slate.
--
--
-- WHY THE DELETES ARE ORDERED
--
-- Most foreign keys here have NO cascade -- expense_splits.member_id in
-- particular, so that nobody with financial history can ever be deleted out
-- from under the ledger. That protection means the order below matters:
-- children first, then periods, then members. TRUNCATE is not used because it
-- cannot be filtered, and this script keeps some rows.
--
-- Pure ASCII. No transaction wrapper. Verification at the end.


-- --------------------  what you are about to destroy  --------------------
-- Run just this block first if you want to see it before doing it.

select 'members (all)' as what, count(*) as rows_now from members
union all select 'expenses',    count(*) from expenses
union all select 'settlements', count(*) from settlements
order by rows_now desc;


-- ---------------------------  the money  ---------------------------
-- Children before parents, because these FKs do not cascade.

delete from audit_log;
delete from notification_reads;
delete from notifications;
delete from pending_changes;

delete from expense_splits;
delete from expenses;
delete from settlements;

delete from away_periods;
delete from recurring_postings;
delete from recurring_expenses;
delete from expense_templates;

delete from invites;
delete from join_requests;

-- Tokens re-register themselves on the next app launch.
delete from push_tokens;

-- Derived from expense dates by the expenses_set_period trigger, which
-- recreates whichever month it needs on the next expense.
delete from periods;


-- ---------------------------  the people  ---------------------------
-- Everyone except the owner. The members_owner_remains constraint trigger
-- requires at least one active owner to survive, and this is what satisfies
-- it -- deleting every member would abort the whole script.

delete from members where role <> 'owner';


-- ---------------------------  verification  ---------------------------
-- Kept: one household, its categories, its payment methods, you.
-- Gone: every expense, split, settlement, trip, rule and notification.

select
  (select count(*) from households)                  as households_kept,
  (select count(*) from categories)                  as categories_kept,
  (select count(*) from payment_methods)             as payment_methods_kept,
  (select count(*) from members)                     as members_kept,
  (select count(*) from members where role = 'owner') as owners_kept,
  (select count(*) from expenses)                    as expenses_left,
  (select count(*) from expense_splits)              as splits_left,
  (select count(*) from settlements)                 as settlements_left,
  (select count(*) from periods)                     as periods_left,
  (select count(*) = 0 from ledger_imbalance())      as ledger_balances;

-- Expected: households_kept 1, categories_kept 13, payment_methods_kept 3,
-- members_kept 1, owners_kept 1, everything ending in _left = 0,
-- ledger_balances true.
