-- Roomly -- invariants and identity helpers
-- These enforce in the database what the app must never be trusted to get right.

-- -------------------  who is calling?  -------------------
-- All SECURITY DEFINER so they can read `members` without tripping the
-- RLS policies that themselves depend on these functions (infinite recursion
-- is the classic Supabase RLS footgun).

begin;

create or replace function current_member()
returns uuid language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid() and left_on is null limit 1;
$$;

create or replace function current_household()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid() and left_on is null limit 1;
$$;

create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where user_id = auth.uid() and role = 'owner' and left_on is null
  );
$$;

create or replace function period_is_open(p_period uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'open' from periods where id = p_period), false);
$$;

-- ------------  every expense belongs to a month  ------------
-- period_id is derived server-side from expense_date and never accepted
-- from the client -- otherwise anyone could backdate into a closed month.

create or replace function set_expense_period()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_period uuid;
begin
  insert into periods (household_id, year, month)
  values (
    new.household_id,
    extract(year  from new.expense_date)::smallint,
    extract(month from new.expense_date)::smallint
  )
  on conflict (household_id, year, month)
    do update set household_id = excluded.household_id   -- no-op, returns the row
  returning id into v_period;

  new.period_id := v_period;
  return new;
end;
$$;

create trigger expenses_set_period
  before insert or update of expense_date on expenses
  for each row execute function set_expense_period();

-- ----------  splits must sum to the total, exactly  ----------
-- The single most important rule in the system. Deferred so a normal
-- "insert expense then insert its splits" transaction can proceed.

create or replace function check_split_balance()
returns trigger language plpgsql as $$
declare
  v_expense uuid := coalesce(new.expense_id, old.expense_id);
  v_total   bigint;
  v_sum     bigint;
begin
  select total_paise into v_total from expenses where id = v_expense;
  if v_total is null then
    return null;                       -- expense itself was deleted; nothing to check
  end if;

  select coalesce(sum(amount_paise), 0) into v_sum
    from expense_splits where expense_id = v_expense;

  if v_sum <> v_total then
    raise exception
      'Split imbalance on expense %: splits sum to % paise, total is % paise',
      v_expense, v_sum, v_total;
  end if;
  return null;
end;
$$;

create constraint trigger expense_splits_balance
  after insert or update or delete on expense_splits
  deferrable initially deferred
  for each row execute function check_split_balance();

-- Changing an expense's total must also rebalance its splits.
create or replace function check_expense_balance()
returns trigger language plpgsql as $$
declare
  v_sum bigint;
begin
  select coalesce(sum(amount_paise), 0) into v_sum
    from expense_splits where expense_id = new.id;

  -- A freshly inserted expense has no splits yet; the splits trigger
  -- catches that at commit time.
  if v_sum > 0 and v_sum <> new.total_paise then
    raise exception
      'Split imbalance on expense %: splits sum to % paise, total is % paise',
      new.id, v_sum, new.total_paise;
  end if;
  return null;
end;
$$;

create constraint trigger expenses_balance
  after insert or update of total_paise on expenses
  deferrable initially deferred
  for each row execute function check_expense_balance();

-- ---------  you can only split with people who lived here  ---------

create or replace function check_split_residency()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_date date;
  v_ok   boolean;
begin
  select e.expense_date into v_date from expenses e where e.id = new.expense_id;

  select (v_date >= m.joined_on and (m.left_on is null or v_date <= m.left_on))
    into v_ok
    from members m where m.id = new.member_id;

  if not coalesce(v_ok, false) then
    raise exception 'Member % did not live here on %', new.member_id, v_date;
  end if;
  return new;
end;
$$;

create trigger splits_residency
  before insert or update on expense_splits
  for each row execute function check_split_residency();

-- --------------  a household always has an owner  --------------

create or replace function check_owner_remains()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_household uuid := coalesce(new.household_id, old.household_id);
begin
  -- If the household itself is gone there is nothing left to own, and
  -- insisting on an owner would make a household undeletable.
  if not exists (select 1 from households where id = v_household) then
    return null;
  end if;

  if not exists (
    select 1 from members
    where household_id = v_household and role = 'owner' and left_on is null
  ) then
    raise exception 'A household must always have at least one active owner';
  end if;
  return null;
end;
$$;

create constraint trigger members_owner_remains
  after update or delete on members
  deferrable initially deferred
  for each row execute function check_owner_remains();

-- -----------------------  audit history  -----------------------

create or replace function write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif tg_op = 'UPDATE' and old.voided_at is null and new.voided_at is not null then
    v_action := 'voided';
  else
    v_action := 'updated';
  end if;

  insert into audit_log (household_id, entity_type, entity_id, action, actor_id, before, after)
  values (
    coalesce(new.household_id, old.household_id),
    tg_table_name,
    coalesce(new.id, old.id),
    v_action,
    current_member(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end;
$$;

create trigger expenses_audit
  after insert or update on expenses
  for each row execute function write_audit();

create trigger settlements_audit
  after insert or update on settlements
  for each row execute function write_audit();

-- Bump rev + updated_at on every expense edit, for optimistic concurrency.
create or replace function touch_expense()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.rev := old.rev + 1;
  return new;
end;
$$;

create trigger expenses_touch
  before update on expenses
  for each row execute function touch_expense();

commit;
