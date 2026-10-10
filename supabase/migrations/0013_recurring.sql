-- Recurring expenses: rent, wifi, maid, water.
--
-- There is no cron here. Postings happen when someone opens the app and the
-- client calls post_due_recurrences() - for monthly bills a few hours of lag
-- is irrelevant, and it avoids a scheduler the household would have to
-- maintain. Idempotency comes from recurring_postings' unique index, not from
-- the client behaving, so ten people opening the app at once still post once.
--
-- Two modes, because they are genuinely different problems:
--   auto    - the amount never changes (rent). Post it and tell them.
--   confirm - the amount varies (electricity). Never guess: prompt instead.
--
-- No transaction wrapper: idempotent DDL, so a failure stops visibly.

create table if not exists recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  category_id   uuid not null references categories(id),
  description   text,
  -- null is only valid for confirm mode, where the amount is asked for
  amount_paise  bigint check (amount_paise is null or amount_paise > 0),
  paid_by       uuid not null references members(id),
  -- capped at 28 so every month has the day; no "31st of February" problem
  day_of_month  smallint not null check (day_of_month between 1 and 28),
  mode          text not null default 'auto' check (mode in ('auto', 'confirm')),
  is_active     boolean not null default true,
  created_by    uuid not null references members(id),
  created_at    timestamptz not null default now(),
  check (mode = 'confirm' or amount_paise is not null)
);
create index if not exists recurring_household_idx on recurring_expenses (household_id);

-- One posting per rule per month, enforced by the primary key rather than by
-- hoping the client only calls once.
create table if not exists recurring_postings (
  recurring_id uuid not null references recurring_expenses(id) on delete cascade,
  year         smallint not null,
  month        smallint not null,
  expense_id   uuid references expenses(id) on delete set null,
  posted_at    timestamptz not null default now(),
  primary key (recurring_id, year, month)
);

alter table recurring_expenses enable row level security;
alter table recurring_postings enable row level security;

drop policy if exists recurring_read on recurring_expenses;
create policy recurring_read on recurring_expenses for select
  using (household_id = current_household());

-- Household bills are configuration, same as categories: owner-managed.
drop policy if exists recurring_owner_write on recurring_expenses;
create policy recurring_owner_write on recurring_expenses for all
  using (household_id = current_household() and is_owner())
  with check (household_id = current_household() and is_owner());

drop policy if exists postings_read on recurring_postings;
create policy postings_read on recurring_postings for select
  using (exists (
    select 1 from recurring_expenses r
    where r.id = recurring_id and r.household_id = current_household()
  ));

-- Postings are only ever written by the functions below.

-- ---------------------------------------------------------------------
-- Shared posting logic. Mirrors the client's splitEqually(): equal shares
-- to the paisa, remainder handed out one at a time starting with the payer.
-- ---------------------------------------------------------------------

create or replace function post_recurring_now(
  p_recurring uuid,
  p_amount    bigint default null,
  p_date      date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r              record;
  v_participants uuid[];
  v_ordered      uuid[];
  v_n            int;
  v_amount       bigint;
  v_base         bigint;
  v_rem          bigint;
  v_expense      uuid;
  v_i            int;
begin
  select re.*, c.respects_away_calendar as away_aware
    into r
    from recurring_expenses re
    join categories c on c.id = re.category_id
   where re.id = p_recurring;

  if r is null then
    raise exception 'No such recurring expense';
  end if;
  if r.household_id <> current_household() then
    raise exception 'That recurring expense belongs to another household';
  end if;

  v_amount := coalesce(p_amount, r.amount_paise);
  if v_amount is null or v_amount <= 0 then
    raise exception 'This recurring expense needs an amount';
  end if;

  -- Already posted for this month? Return the existing expense rather than
  -- raising, so a double tap is harmless.
  select rp.expense_id into v_expense
    from recurring_postings rp
   where rp.recurring_id = p_recurring
     and rp.year = extract(year from p_date)::smallint
     and rp.month = extract(month from p_date)::smallint;
  if found then
    return v_expense;
  end if;

  -- Who was living here, and - for consumption categories only - who was
  -- actually around. Rent ignores the away calendar; groceries do not.
  select array_agg(m.id order by m.created_at)
    into v_participants
    from members m
   where m.household_id = r.household_id
     and m.joined_on <= p_date
     and (m.left_on is null or m.left_on >= p_date)
     and (
       not r.away_aware
       or not exists (
         select 1 from away_periods a
          where a.member_id = m.id
            and p_date >= a.start_date
            and (a.end_date is null or p_date <= a.end_date)
       )
     );

  if v_participants is null or array_length(v_participants, 1) = 0 then
    raise exception 'Nobody was living here on % - cannot split', p_date;
  end if;

  -- Payer first so they absorb the leftover paise, matching the client.
  v_ordered := array(
    select p from unnest(v_participants) p order by (p <> r.paid_by), p
  );

  v_n    := array_length(v_ordered, 1);
  v_base := v_amount / v_n;
  v_rem  := v_amount - v_base * v_n;

  perform ensure_period(r.household_id, p_date);

  insert into expenses (
    household_id, paid_by, total_paise, description,
    category_id, expense_date, created_by
  ) values (
    r.household_id, r.paid_by, v_amount,
    nullif(trim(coalesce(r.description, '')), ''),
    r.category_id, p_date, r.created_by
  )
  returning id into v_expense;

  for v_i in 1..v_n loop
    insert into expense_splits (expense_id, member_id, amount_paise)
    values (v_expense, v_ordered[v_i], v_base + (case when v_i <= v_rem then 1 else 0 end));
  end loop;

  insert into recurring_postings (recurring_id, year, month, expense_id)
  values (p_recurring, extract(year from p_date)::smallint,
          extract(month from p_date)::smallint, v_expense)
  -- Someone else's app posted it a millisecond ago; that's fine.
  on conflict (recurring_id, year, month) do nothing;

  return v_expense;
end;
$$;

-- Called on app open. Posts every due 'auto' rule that hasn't run this month.
create or replace function post_due_recurrences()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_house uuid := current_household();
  r       record;
  v_due   date;
  v_count int := 0;
begin
  if v_house is null then
    return 0;
  end if;

  for r in
    select re.id, re.day_of_month
      from recurring_expenses re
     where re.household_id = v_house
       and re.is_active
       and re.mode = 'auto'
       and re.amount_paise is not null
  loop
    v_due := make_date(
      extract(year  from current_date)::int,
      extract(month from current_date)::int,
      r.day_of_month
    );

    continue when v_due > current_date;

    if exists (
      select 1 from recurring_postings rp
       where rp.recurring_id = r.id
         and rp.year = extract(year from v_due)::smallint
         and rp.month = extract(month from v_due)::smallint
    ) then
      continue;
    end if;

    perform post_recurring_now(r.id, null, v_due);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function post_recurring_now(uuid, bigint, date) to authenticated;
grant execute on function post_due_recurrences() to authenticated;

-- Confirms it worked: all four should be true.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'recurring_expenses') = 1 as recurring_table,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'recurring_postings') = 1 as postings_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_recurring_now')   = 1 as post_now_fn,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_due_recurrences') = 1 as post_due_fn;
