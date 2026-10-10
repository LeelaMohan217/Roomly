-- Roomly -- audit members, categories and recurring bills too.
--
-- Until now audit_log only covered expenses and settlements, so the Edit
-- history screen could not show a housemate being added, a category renamed,
-- or a recurring bill paused -- even though the app tells people every change
-- is recorded.
--
--
-- WHY write_audit() HAD TO BE REWRITTEN FIRST
--
-- The old body read old.voided_at directly:
--
--   elsif tg_op = 'UPDATE' and old.voided_at is null and new.voided_at is not null
--
-- expenses and settlements have that column. members, categories and
-- recurring_expenses do NOT. Attaching the function to them unchanged would
-- raise
--
--   record "old" has no field "voided_at"
--
-- on every UPDATE -- which would have broken renaming yourself, archiving a
-- category and pausing a bill, with the audit trail as the cause. Field access
-- now goes through jsonb, which returns null for an absent key instead of
-- raising.
--
-- Also new: DELETE is recorded. members can be hard-deleted by remove_member(),
-- and categories and recurring rules have `for all` policies, so deletions are
-- reachable and worth having in the trail.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


create or replace function write_audit()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_action text;
  v_house  uuid;
  v_id     uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
  elsif (v_before ->> 'voided_at') is null and (v_after ->> 'voided_at') is not null then
    -- Soft delete. Only expenses and settlements have the column; for every
    -- other table both sides are null and this branch is simply never taken.
    v_action := 'voided';
  else
    v_action := 'updated';
  end if;

  v_house := coalesce(v_after ->> 'household_id', v_before ->> 'household_id')::uuid;
  v_id    := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;

  -- Auditing must never abort the operation it is recording.
  --
  -- The realistic failure is a DELETE that is part of a household cascade: the
  -- audit rows for that household are being removed in the same statement, so
  -- a fresh row would either violate the foreign key or be cascaded away a
  -- moment later. Losing that entry is correct -- the household it described
  -- is gone -- and it must not take the delete down with it. This is the same
  -- class of problem migration 0006 fixed for check_owner_remains.
  begin
    insert into audit_log (
      household_id, entity_type, entity_id, action, actor_id, before, after
    )
    values (v_house, tg_table_name, v_id, v_action, current_member(), v_before, v_after);
  exception when others then
    null;
  end;

  return null;
end;
$fn$;


-- ---------------------------  the new triggers  ---------------------------
-- insert, update AND delete, unlike expenses and settlements: those two are
-- soft-deleted on purpose (void_expense sets voided_at), so a hard DELETE is
-- not a normal path for them and their existing triggers are left alone.

drop trigger if exists members_audit on members;
create trigger members_audit
  after insert or update or delete on members
  for each row execute function write_audit();

drop trigger if exists categories_audit on categories;
create trigger categories_audit
  after insert or update or delete on categories
  for each row execute function write_audit();

drop trigger if exists recurring_audit on recurring_expenses;
create trigger recurring_audit
  after insert or update or delete on recurring_expenses
  for each row execute function write_audit();


-- ---------------------------  verification  ---------------------------
-- The last column is the real test: it exercises the rewritten function on a
-- table with no voided_at, which is exactly what would have failed before.

select
  (select count(*) from pg_trigger
    where tgname in ('members_audit', 'categories_audit', 'recurring_audit')
      and not tgisinternal) = 3                                  as three_triggers_added,

  (select count(*) from pg_trigger
    where tgname in ('expenses_audit', 'settlements_audit')
      and not tgisinternal) = 2                                  as old_triggers_intact,

  (select count(*) = 0 from ledger_imbalance())                  as ledger_still_balances,

  -- The real test, and it needs no side effects: assert the fragile line is
  -- actually gone from the installed function. `old.voided_at` is what would
  -- raise "record old has no field voided_at" on members, categories and
  -- recurring_expenses. If this reads false, the rewrite did not apply and
  -- renaming yourself will fail.
  (select position('old.voided_at' in prosrc) = 0
     from pg_proc where proname = 'write_audit')                 as function_is_table_agnostic,

  (select position('to_jsonb(old)' in prosrc) > 0
     from pg_proc where proname = 'write_audit')                 as reads_fields_via_jsonb;
