-- Combined re-application of 0009 + 0010, which did not take.
--
-- No BEGIN/COMMIT wrapper on purpose: every statement here is either
-- CREATE OR REPLACE or an idempotent UPDATE, so re-running is harmless, and
-- without a transaction a failure stops at the offending statement instead
-- of silently discarding everything before it.
--
-- This file is deliberately pure ASCII. Emoji live in src/lib/icons.ts, keyed
-- by the slugs set below, so no multi-byte character ever has to survive a
-- clipboard round trip again.

-- ---------------------------------------------------------------------
-- 1. The RLS failure on the first expense of a month.
--    period_is_open() was STABLE, so it read the snapshot from the start of
--    the statement and could not see the periods row created by a BEFORE
--    trigger of that same INSERT.
-- ---------------------------------------------------------------------

create or replace function period_is_open(p_period uuid)
returns boolean language sql volatile security definer set search_path = public as $fn$
  select coalesce((select status = 'open' from periods where id = p_period), false);
$fn$;

create or replace function ensure_period(p_household uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_period uuid;
begin
  insert into periods (household_id, year, month)
  values (
    p_household,
    extract(year  from p_date)::smallint,
    extract(month from p_date)::smallint
  )
  on conflict (household_id, year, month)
    do update set household_id = excluded.household_id
  returning id into v_period;

  return v_period;
end;
$fn$;

create or replace function set_expense_period()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.period_id := ensure_period(new.household_id, new.expense_date);
  return new;
end;
$fn$;

create or replace function set_settlement_period()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.period_id := ensure_period(new.household_id, new.settled_on);
  return new;
end;
$fn$;

create or replace function create_expense(
  p_total_paise    bigint,
  p_category       uuid,
  p_expense_date   date,
  p_paid_by        uuid,
  p_splits         jsonb,
  p_description    text default null,
  p_payment_method uuid default null
) returns uuid
language plpgsql as $fn$
declare
  v_me      uuid := current_member();
  v_house   uuid := current_household();
  v_expense uuid;
  v_split   jsonb;
  v_sum     bigint;
begin
  if v_me is null then
    raise exception 'You are not a member of any household';
  end if;

  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'An expense needs at least one participant';
  end if;

  select sum((s->>'amount_paise')::bigint) into v_sum
    from jsonb_array_elements(p_splits) s;

  if v_sum <> p_total_paise then
    raise exception 'Splits sum to % paise but the total is % paise', v_sum, p_total_paise;
  end if;

  -- Separate statement, so the RLS check that follows can see the period.
  perform ensure_period(v_house, p_expense_date);

  insert into expenses (
    household_id, paid_by, total_paise, description,
    category_id, payment_method_id, expense_date, created_by
  ) values (
    v_house, p_paid_by, p_total_paise, nullif(trim(coalesce(p_description, '')), ''),
    p_category, p_payment_method, p_expense_date, v_me
  )
  returning id into v_expense;

  for v_split in select * from jsonb_array_elements(p_splits) loop
    insert into expense_splits (expense_id, member_id, amount_paise)
    values (v_expense, (v_split->>'member_id')::uuid, (v_split->>'amount_paise')::bigint);
  end loop;

  return v_expense;
end;
$fn$;

create or replace function record_settlement(
  p_from   uuid,
  p_to     uuid,
  p_amount bigint,
  p_date   date default current_date,
  p_note   text default null
) returns uuid
language plpgsql as $fn$
declare
  v_me    uuid := current_member();
  v_house uuid := current_household();
  v_id    uuid;
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

  perform ensure_period(v_house, p_date);

  insert into settlements (household_id, from_member, to_member, amount_paise, settled_on, note, created_by)
  values (v_house, p_from, p_to, p_amount, p_date, nullif(trim(coalesce(p_note, '')), ''), v_me)
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function ensure_period(uuid, date) to authenticated;
grant execute on function create_expense(bigint, uuid, date, uuid, jsonb, text, uuid) to authenticated;
grant execute on function record_settlement(uuid, uuid, bigint, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Category icons become ASCII slugs; the app maps them to glyphs.
-- ---------------------------------------------------------------------

update categories set icon = 'rent'        where name = 'Rent';
update categories set icon = 'electricity' where name = 'Electricity';
update categories set icon = 'water'       where name = 'Water';
update categories set icon = 'wifi'        where name = 'Wifi';
update categories set icon = 'maid'        where name = 'Maid';
update categories set icon = 'gas'         where name = 'Gas Cylinder';
update categories set icon = 'supplies'    where name = 'Household Supplies';
update categories set icon = 'groceries'   where name = 'Groceries';
update categories set icon = 'milk'        where name = 'Milk';
update categories set icon = 'vegetables'  where name = 'Vegetables';
update categories set icon = 'dining'      where name = 'Eating Out';
update categories set icon = 'transport'   where name = 'Transport';
update categories set icon = 'misc'        where name = 'Misc';

update categories set icon = 'misc'
 where icon is null or icon !~ '^[a-z]+$';

create or replace function create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from members where user_id = auth.uid() and left_on is null) then
    raise exception 'You already belong to a household';
  end if;

  insert into households (name) values (p_name) returning id into v_household;

  insert into members (household_id, user_id, display_name, role)
  values (v_household, auth.uid(), p_display_name, 'owner');

  insert into categories (household_id, name, icon, kind, respects_away_calendar, sort_order)
  values
    (v_household, 'Rent',               'rent',        'fixed',       false, 1),
    (v_household, 'Electricity',        'electricity', 'fixed',       false, 2),
    (v_household, 'Water',              'water',       'fixed',       false, 3),
    (v_household, 'Wifi',               'wifi',        'fixed',       false, 4),
    (v_household, 'Maid',               'maid',        'fixed',       false, 5),
    (v_household, 'Gas Cylinder',       'gas',         'bulk',        false, 6),
    (v_household, 'Household Supplies', 'supplies',    'bulk',        false, 7),
    (v_household, 'Groceries',          'groceries',   'consumption', true,  8),
    (v_household, 'Milk',               'milk',        'consumption', true,  9),
    (v_household, 'Vegetables',         'vegetables',  'consumption', true, 10),
    (v_household, 'Eating Out',         'dining',      'consumption', true, 11),
    (v_household, 'Transport',          'transport',   'consumption', true, 12),
    (v_household, 'Misc',               'misc',        'consumption', true, 13);

  insert into payment_methods (household_id, name)
  values (v_household, 'Cash'), (v_household, 'UPI'), (v_household, 'Card');

  return v_household;
end;
$fn$;

grant execute on function create_household(text, text) to authenticated;

-- Confirms it worked: all three should be true.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_period')     = 1 as ensure_period_created,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement') = 1 as record_settlement_created,
  (select count(*) from categories where icon !~ '^[a-z]+$')        = 0 as icons_are_slugs;
