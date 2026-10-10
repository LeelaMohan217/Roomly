-- Roomly -- the settlement period trigger never landed, so no payment could
-- ever be recorded. And record_settlement goes back to being checked twice.
--
-- THE ACTUAL BUG, which 0032 misdiagnosed.
--
--   ERROR: 23502: null value in column "period_id" of relation "settlements"
--          violates not-null constraint
--   CONTEXT: PL/pgSQL function record_settlement(...) line 65
--
-- settlements.period_id is `not null` (0001_schema.sql:118) and no RPC has ever
-- set it. It is filled by a BEFORE trigger, settlements_set_period, created in
-- 0008_settlements.sql:28 -- the migration wrapped in `begin; ... commit;`. That
-- transaction rolled back. 0011's own header records the same thing happening
-- to 0009 and 0010: "migrations 0009 and 0010 silently rolled back and cost two
-- rounds of debugging before anyone noticed", which is why every migration
-- since has been written without a transaction wrapper and with a verification
-- SELECT at the bottom.
--
-- 0011 then re-applied 0009's fixes, and re-created the FUNCTION
-- set_settlement_period() (0011:51-57) -- but not the TRIGGER that calls it. A
-- function nothing invokes. So the repo has read as correct all along while the
-- database had no trigger on settlements, and expenses were unaffected because
-- expenses_set_period comes from 0002 (0002:58), which did land.
--
-- Consequence: settle-up has never worked in this household. Not for the owner,
-- not for anybody, not once. period_id stayed null on every attempt.
--
--
-- WHY IT LOOKED LIKE A PERMISSION PROBLEM FOR THREE ROUNDS
--
-- settlements_insert ends in `period_is_open(period_id)` (0003_rls.sql:123),
-- and period_is_open(null) is `coalesce((select ... where id = null), false)`
-- -- FALSE. So RLS refused the row, Postgres reported 42501, and errors.ts:30
-- rendered that as "You don't have permission to do that." for everyone
-- including the owner.
--
-- The policy was right. It was correctly refusing a row that had no month. The
-- error named the check that failed rather than the reason it failed, and
-- nothing in the app or the schema said which column was empty.
--
--
-- SO 0032 IS PARTLY REVERTED HERE.
--
-- 0032 made record_settlement SECURITY DEFINER to get out from under a 42501
-- nobody could explain. That was the wrong conclusion from a real symptom: it
-- did not fix the null period_id, it skipped the check that was reporting it,
-- and the same insert then failed one layer down on the not-null constraint --
-- as 23502, which errors.ts could not name either.
--
-- Now that the cause is known there is no reason for this function to run with
-- the definer's rights. It writes money; being checked twice is the point. So:
--
--   * record_settlement goes back to SECURITY INVOKER, and RLS backs it up
--     again. 0032's verification confirmed both things it needs are present
--     (policy_present and grant_present read true).
--   * the in-code period_is_open() check that 0032 added STAYS. It is what
--     turns a closed month into a sentence a person can act on instead of a
--     policy refusal, and it now runs before the insert either way.
--   * period_id is set EXPLICITLY from the value the function already computes,
--     so this write no longer depends on a trigger existing at all. The trigger
--     is restored below as well, for any other path into the table, but nothing
--     in the settle flow relies on it any more.
--
-- Belt and braces, in the sense 0009 meant it: two independent things now have
-- to be missing before period_id can come out null again, and the verification
-- at the bottom asserts every trigger in the schema rather than just this one.
--
-- No signature change, so this needs no new APK.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  the trigger that never landed  ---------------------
-- The function has existed since 0011 with nothing calling it. Recreated here
-- with the same shape 0008 intended: `of settled_on` on UPDATE, so moving a
-- payment to another date refiles it into the right month.

drop trigger if exists settlements_set_period on settlements;
create trigger settlements_set_period
  before insert or update of settled_on on settlements
  for each row execute function set_settlement_period();


-- ---------------------  and the write stops depending on it  ---------------
-- period_id is passed in the insert. The trigger above overwrites it with the
-- same value (both go through ensure_period on the same date), so the two agree
-- by construction rather than by hope -- and either one alone is enough.

create or replace function record_settlement(
  p_from   uuid,
  p_to     uuid,
  p_amount bigint,
  p_date   date default null,
  p_note   text default null
) returns uuid
language plpgsql as $fn$
declare
  v_me      uuid := current_member();
  v_house   uuid := current_household();
  v_when    date;
  v_period  uuid;
  v_balance bigint;
  v_id      uuid;
begin
  if v_me is null then
    raise exception 'You are not a member of any household';
  end if;
  if p_from = p_to then
    raise exception 'A settlement needs two different people';
  end if;
  if p_amount <= 0 then
    raise exception 'A settlement must be a positive amount';
  end if;

  -- Both parties must be ours, or a payment lands in another household's
  -- balances and breaks their zero-sum canary. (0026)
  if not exists (select 1 from members where id = p_from and household_id = v_house) then
    raise exception 'The payer is not a member of this household';
  end if;
  if not exists (select 1 from members where id = p_to and household_id = v_house) then
    raise exception 'The payee is not a member of this household';
  end if;

  -- A member may only record a payment they are part of. The owner may record
  -- anybody's -- the plan routes payments through third parties, so the owner
  -- is regularly looking at a transfer between two other people. The payee
  -- still has to confirm it. (0026)
  if not is_owner() and v_me <> p_from and v_me <> p_to then
    raise exception 'You can only record a payment you are part of';
  end if;

  -- member_balance() is positive when the house owes this person, so a payer at
  -- or above zero is being asked to pay a debt they do not have. (0029)
  v_balance := member_balance(p_from);

  if v_balance >= 0 then
    raise exception
      '% does not owe anything right now, so recording a payment from them would make the ledger wrong in the other direction. Did you mean % paid % instead?',
      (select display_name from members where id = p_from),
      (select display_name from members where id = p_to),
      (select display_name from members where id = p_from);
  end if;

  -- household_today(), not current_date: the server is UTC and is a day behind
  -- for the first five and a half hours of every Indian morning. (0030)
  v_when   := coalesce(p_date, household_today(v_house));

  -- Its own statement, so the RLS check on the insert below can see the period
  -- row -- the reason 0009 and 0011 both wrote it this way.
  v_period := ensure_period(v_house, v_when);

  -- Checked here as well as by settlements_insert, because a policy refusal is
  -- a 42501 with nothing in it a person can act on, and this is the one term of
  -- that policy a caller can actually do something about. (0032)
  if not period_is_open(v_period) then
    raise exception
      'That month is closed. Reopen it from the month statement before recording a payment in it.';
  end if;

  insert into settlements (
    household_id, period_id, from_member, to_member, amount_paise, settled_on,
    note, created_by, confirmed_at, confirmed_by
  )
  values (
    v_house, v_period, p_from, p_to, p_amount, v_when,
    nullif(trim(coalesce(p_note, '')), ''), v_me,
    -- The payee saying "I got it" IS the confirmation. Anyone else recording
    -- it -- including the owner -- is making a claim the payee has to agree to.
    case when v_me = p_to then now() else null end,
    case when v_me = p_to then v_me  else null end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function record_settlement(uuid, uuid, bigint, date, text) to authenticated;


-- ---------------------------  verification  ---------------------------
-- Every column must read true.
--
-- `all_triggers_present` is the one to actually read. A single missing trigger
-- cost three rounds of debugging here, so this asserts the whole set rather
-- than the one that was broken -- every `create trigger` in migrations 0002
-- through 0024, counted by name. If it reads false, run the query underneath to
-- see which one is absent.

select
  (select count(*) from pg_trigger
    where tgname = 'settlements_set_period' and not tgisinternal)      = 1 as period_trigger_back,
  (select prosrc like '%period_id,%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')         as period_set_in_code,
  (select not prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')         as rls_backs_it_up_again,
  (select prosrc like '%month is closed%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')         as closed_month_readable,
  (select count(*) from pg_policies
    where tablename = 'settlements' and policyname = 'settlements_insert')= 1 as policy_still_there,
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
     'expenses_set_period', 'expense_splits_balance', 'expenses_balance',
     'splits_residency', 'members_owner_remains', 'expenses_audit',
     'settlements_audit', 'expenses_touch', 'settlements_set_period',
     'expenses_notify', 'settlements_notify', 'members_notify',
     'members_audit', 'categories_audit', 'recurring_audit',
     'splits_departed_guard', 'expenses_departed_guard'))               = 17 as all_triggers_present,
  (select count(*) = 0 from ledger_imbalance())                              as ledger_still_balances;


-- Which trigger is missing, if all_triggers_present read false:
--
--   select t.expected
--     from unnest(array[
--       'expenses_set_period', 'expense_splits_balance', 'expenses_balance',
--       'splits_residency', 'members_owner_remains', 'expenses_audit',
--       'settlements_audit', 'expenses_touch', 'settlements_set_period',
--       'expenses_notify', 'settlements_notify', 'members_notify',
--       'members_audit', 'categories_audit', 'recurring_audit',
--       'splits_departed_guard', 'expenses_departed_guard'
--     ]) as t(expected)
--    where not exists (
--      select 1 from pg_trigger g
--       where g.tgname = t.expected and not g.tgisinternal
--    );
