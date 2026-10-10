-- Fixes the "new row violates row-level security policy for table expenses"
-- that hits the FIRST expense of any month.
--
-- The insert policy calls period_is_open(period_id). That period row is
-- created by a BEFORE trigger of the very same INSERT, and period_is_open was
-- declared STABLE -- a stable function reads the snapshot from the start of the
-- statement, so it cannot see a row its own statement just wrote. The check
-- returned false and Postgres rejected a perfectly legitimate expense.
--
-- Two fixes, deliberately belt and braces:
--   1. period_is_open becomes VOLATILE, so it sees the live transaction.
--   2. the period row is created by a SEPARATE earlier statement, so even a
--      stable read would find it.

begin;

-- Volatile, not stable: this must observe writes made earlier in the same
-- transaction, including by triggers.
create or replace function period_is_open(p_period uuid)
returns boolean language sql volatile security definer set search_path = public as $$
  select coalesce((select status = 'open' from periods where id = p_period), false);
$$;

-- Shared by the expense trigger, the settlement trigger, and the RPCs below.
create or replace function ensure_period(p_household uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
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
$$;

create or replace function set_expense_period()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.period_id := ensure_period(new.household_id, new.expense_date);
  return new;
end;
$$;

create or replace function set_settlement_period()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.period_id := ensure_period(new.household_id, new.settled_on);
  return new;
end;
$$;

-- Create the period up front, as its own statement, before the row that
-- depends on it.
create or replace function create_expense(
  p_total_paise    bigint,
  p_category       uuid,
  p_expense_date   date,
  p_paid_by        uuid,
  p_splits         jsonb,
  p_description    text default null,
  p_payment_method uuid default null
) returns uuid
language plpgsql as $$
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

  -- Separate statement, so the RLS check that follows can see it.
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
$$;

-- Settlements hit exactly the same wall on the first payment of a month.
create or replace function record_settlement(
  p_from   uuid,
  p_to     uuid,
  p_amount bigint,
  p_date   date default current_date,
  p_note   text default null
) returns uuid
language plpgsql as $$
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
$$;

grant execute on function
  ensure_period(uuid, date),
  create_expense(bigint, uuid, date, uuid, jsonb, text, uuid),
  record_settlement(uuid, uuid, bigint, date, text)
to authenticated;

commit;
