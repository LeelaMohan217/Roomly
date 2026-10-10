-- Roomly -- recording a payment stops asking RLS for permission it already has.
--
-- THE BUG. Every transfer on the "Fewest payments" tab fails with
--
--   You don't have permission to do that.
--
-- for every member INCLUDING THE OWNER. That sentence is errors.ts:30 -- the
-- rendering of Postgres 42501 (insufficient_privilege) -- so whatever went
-- wrong, it was a privilege or a policy, not one of this schema's own
-- `raise exception` messages (those are P0001 and errors.ts:100 shows them
-- verbatim).
--
-- record_settlement has been the only writer of `settlements` since 0009, and
-- it is the ONE privileged write in this schema that is SECURITY INVOKER
-- (0009:123, and every replacement since -- 0011, 0019, 0026, 0029, 0030 --
-- copied that). So its insert is checked against settlements_insert
-- (0003_rls.sql:119-124):
--
--   household_id = current_household()
--   and created_by = current_member()
--   and period_is_open(period_id)
--
-- All three terms are things the function has ALREADY established in code -- it
-- derives household_id and created_by from current_household()/current_member()
-- itself and never takes them from the client. The policy re-derives the same
-- two values and re-compares them to themselves. It adds exactly one fact the
-- function does not check: the month lock.
--
-- What it also adds is a single point of failure with no override. Note what is
-- NOT in that policy: `is_owner()`. Unlike expenses_owner_update two blocks
-- above it, there is no owner clause, so when this check refuses, it refuses
-- everybody -- which is the symptom. Any of these produces it, and all of them
-- are invisible from the app:
--
--   * the policy is missing or was dropped -- RLS with no matching INSERT
--     policy is not an error, it is a refusal, and reads keep working because
--     settlements_read is a separate policy
--   * INSERT on settlements is not granted to `authenticated`
--   * period_is_open() is the STABLE build from 0002:29 rather than the
--     VOLATILE one 0009/0011 replaced it with, so the check cannot see the
--     period row the same transaction just created
--
-- THE FIX. Make record_settlement SECURITY DEFINER, like create_household,
-- add_placeholder_member, review_settlement, close_period, post_recurring_now
-- and remove_member -- all of which validate their own caller in procedural
-- code precisely because a policy cannot express what they need. This function
-- was already written that way; it just was not declared that way.
--
-- Its guards are the whole of what RLS was contributing, plus more:
--
--   household_id      derived from current_household(), never a parameter
--   created_by        derived from current_member(), never a parameter
--   both parties      must be members of that household        (0026)
--   the caller        must be a party, or the owner            (0026)
--   the direction     must match the payer's confirmed balance (0029)
--   THE MONTH LOCK    added below -- this is the one term the function did not
--                     restate, and the only reason the policy was load-bearing
--
-- 0024:43-44 already made this argument about a different check: "guarded with
-- triggers rather than policies, so the SECURITY DEFINER functions -- which RLS
-- does not constrain -- are covered too." Same reasoning, other direction: a
-- check every writer performs in code does not also need to be the thing that
-- can silently lock the household out.
--
-- settlements_insert is recreated at the end anyway, unchanged. It no longer
-- guards this path, but it is still the backstop for any direct client insert,
-- and recreating it repairs the case where it had gone missing.
--
-- No signature change, so this needs no new APK.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  recording a payment  ---------------------

create or replace function record_settlement(
  p_from   uuid,
  p_to     uuid,
  p_amount bigint,
  p_date   date default null,
  p_note   text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
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

  -- Both parties must be ours. SECURITY DEFINER means this is now the ONLY
  -- thing standing between a hand-rolled call and another household's ledger,
  -- so it matters more than it did, not less.
  if not exists (select 1 from members where id = p_from and household_id = v_house) then
    raise exception 'The payer is not a member of this household';
  end if;
  if not exists (select 1 from members where id = p_to and household_id = v_house) then
    raise exception 'The payee is not a member of this household';
  end if;

  -- A member may only record a payment they are actually part of. The owner may
  -- record anybody's -- the plan on the Settle screen routes payments through
  -- third parties, so the owner is regularly looking at a transfer between two
  -- other people. The payee still has to confirm it (0026).
  if not is_owner() and v_me <> p_from and v_me <> p_to then
    raise exception 'You can only record a payment you are part of';
  end if;

  -- member_balance() is positive when the house owes this person, so a payer
  -- at or above zero is being asked to pay a debt they do not have. (0029)
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
  v_period := ensure_period(v_house, v_when);

  -- THE NEW CHECK, and the reason this migration is safe. RLS is not going to
  -- see the insert below any more, so the month lock -- the one term of
  -- settlements_insert this function did not already enforce -- is stated here.
  -- Same shape as review_settlement (0026:174-177), which needed it for the
  -- same reason.
  if not period_is_open(v_period) then
    raise exception
      'That month is closed. Reopen it from the month statement before recording a payment in it.';
  end if;

  insert into settlements (
    household_id, from_member, to_member, amount_paise, settled_on, note, created_by,
    confirmed_at, confirmed_by
  )
  values (
    v_house, p_from, p_to, p_amount, v_when,
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


-- ---------------  the policy, restored rather than removed  ---------------
-- Recreated exactly as 0003 wrote it. It no longer decides whether the Settle
-- screen works, but it is still what refuses a direct client insert into
-- settlements, and if it had gone missing -- one of the three candidates in the
-- header -- this puts it back.

drop policy if exists settlements_insert on settlements;
create policy settlements_insert on settlements for insert
  with check (
    household_id = current_household()
    and created_by = current_member()
    and period_is_open(period_id)
  );

-- The other two candidates, closed the same way: idempotent, and no-ops if they
-- were never the problem.
grant insert, select on settlements to authenticated;

create or replace function period_is_open(p_period uuid)
returns boolean language sql volatile security definer set search_path = public as $fn$
  select coalesce((select status = 'open' from periods where id = p_period), false);
$fn$;


-- ---------------------------  verification  ---------------------------
-- The first four must read true. `was_the_policy_missing` and
-- `was_the_grant_missing` are the post-mortem: they read false now because this
-- migration just fixed them, so if you want to know which of the three it
-- actually was, run the DIAGNOSTIC block below BEFORE applying this file.

select
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')      as runs_as_definer,
  (select prosrc like '%month is closed%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')      as month_lock_in_code,
  (select prosrc like '%not a member of this household%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')      as parties_still_scoped,
  (select prosrc like '%member_balance(p_from)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')      as direction_still_checked,
  (select count(*) from pg_policies
    where tablename = 'settlements' and policyname = 'settlements_insert') = 1 as policy_present,
  has_table_privilege('authenticated', 'settlements', 'insert')            as grant_present,
  (select not provolatile = 's' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'period_is_open')          as period_check_not_stable,
  (select count(*) = 0 from ledger_imbalance())                           as ledger_still_balances;


-- ---------------------------  DIAGNOSTIC  ---------------------------
-- Run this INSTEAD OF the file above if you want to know which of the three
-- causes it was. Read-only.
--
--   select
--     (select count(*) from pg_policies
--       where tablename = 'settlements' and policyname = 'settlements_insert') as insert_policies,
--     has_table_privilege('authenticated', 'settlements', 'insert')            as can_insert,
--     (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'period_is_open')           as period_volatility,
--     (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'record_settlement')        as settlement_fn_definer,
--     (select string_agg(p.year || '-' || p.month || ' ' || p.status, ', ' order by p.year desc, p.month desc)
--        from periods p)                                                       as periods;
--
--   insert_policies = 0   -> the policy had been dropped
--   can_insert = false    -> the grant was missing
--   period_volatility='s' -> period_is_open was the STABLE build from 0002
