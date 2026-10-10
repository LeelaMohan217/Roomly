-- Roomly -- let a household enter the month it actually started in.
--
-- THE BUG. members.joined_on is `date not null default current_date`
-- (0001_schema.sql:37) and NOTHING anywhere writes it. Not
-- add_placeholder_member (0004_functions.sql:71-73), not review_join_request,
-- no RPC, no screen. grep confirms it: every other reference in the codebase
-- reads it.
--
-- check_split_residency (0002_invariants.sql:122-143) then refuses any split
-- dated before that day. So a household set up on the 15th cannot enter the
-- 1st-to-14th, which is most of the month it was set up in, and there is no
-- way to correct it short of raw SQL. Every attempt fails with "Member X did
-- not live here on <date>", which reads like a bug in the away calendar rather
-- than a fact about a column nobody can set.
--
-- Offline it is worse: submitExpense queues the write, the drain retries five
-- times and then marks the item blocked (outbox.ts:87), so the user sees a
-- stuck queue instead of the actual reason.
--
-- Two fixes:
--
--   1. add_placeholder_member takes p_joined_on, and DEFAULTS TO THE
--      HOUSEHOLD'S CREATION DATE rather than today. Adding a fourth flatmate
--      in March to a household that started in January should not silently
--      exclude them from January and February, which is the wrong default in
--      the overwhelmingly common case: the people were already living there.
--
--   2. set_member_joined_on, so the households that already exist -- every one
--      created before this migration -- can be corrected.
--
-- Deliberately NOT backfilled automatically. Rewriting joined_on on live rows
-- would change who is a valid participant on dates that already have splits,
-- and this project's position is that a stored figure is corrected
-- deliberately, not by a migration guessing.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  adding someone who was already here  ---------------------

drop function if exists add_placeholder_member(text, text);

create or replace function add_placeholder_member(
  p_name      text,
  p_email     text default null,
  p_joined_on date default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_member    uuid;
  v_household uuid := current_household();
  v_start     date;
begin
  if not is_owner() then
    raise exception 'Only the owner can add members';
  end if;

  -- The household's own start, not today. These are flatmates, not new
  -- arrivals -- the usual reason to add one is that you are catching the app
  -- up with a room that has existed for months.
  select created_at::date into v_start from households where id = v_household;

  insert into members (household_id, display_name, invited_email, joined_on)
  values (v_household, p_name, p_email, coalesce(p_joined_on, v_start, current_date))
  returning id into v_member;

  return v_member;
end;
$fn$;

grant execute on function add_placeholder_member(text, text, date) to authenticated;


-- ---------------------  correcting one afterwards  ---------------------

create or replace function set_member_joined_on(p_member uuid, p_joined_on date)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_target   members%rowtype;
  v_earliest date;
begin
  if not is_owner() then
    raise exception 'Only the owner can change when someone moved in';
  end if;

  select * into v_target
    from members
   where id = p_member and household_id = current_household();

  if not found then
    raise exception 'That person is not in this household';
  end if;

  if p_joined_on is null then
    raise exception 'A move-in date is required';
  end if;

  -- The check constraint on members says as much, but saying it here gives a
  -- sentence rather than a constraint name.
  if v_target.left_on is not null and p_joined_on > v_target.left_on then
    raise exception 'They cannot have moved in after they moved out.';
  end if;

  -- Moving the date LATER could orphan splits that already exist on days it
  -- would now exclude. check_split_residency only fires on write, so nothing
  -- would re-validate them and the ledger would quietly hold splits for
  -- someone who, on paper, did not live here.
  select min(e.expense_date) into v_earliest
    from expense_splits s
    join expenses e on e.id = s.expense_id
   where s.member_id = p_member;

  if v_earliest is not null and p_joined_on > v_earliest then
    raise exception
      'They already have a share of an expense dated %. Move-in cannot be later than that.',
      v_earliest;
  end if;

  update members set joined_on = p_joined_on where id = p_member;
end;
$fn$;

comment on function set_member_joined_on(uuid, date) is
  'Owner-only. Backdating is the point: a household set up mid-month cannot '
  'otherwise enter the days before it existed, because check_split_residency '
  'refuses splits dated before joined_on. Moving the date later is refused '
  'once the member has any split, since nothing would re-validate those rows.';

grant execute on function set_member_joined_on(uuid, date) to authenticated;


-- ---------------------------  verification  ---------------------------
-- All five must read true. The third is the substance: the default is the
-- household's start, not the day you happened to tap Add.

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_placeholder_member')    = 1 as one_add_fn,
  (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_placeholder_member')    = 3 as takes_joined_on,
  (select prosrc like '%households%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_placeholder_member')         as defaults_to_start,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_member_joined_on')      = 1 as correction_fn,
  (select count(*) = 0 from ledger_imbalance())                                 as ledger_still_balances;
