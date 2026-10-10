-- Roomly -- two months of demo activity.
--
-- NOT a migration. This is sample data, so it lives outside migrations/ and is
-- designed to be removed again: every expense it creates is recorded in
-- demo_seed_log, and the block at the bottom of this file deletes exactly
-- those rows and nothing else. Your existing expenses are never touched.
--
-- What it sets up:
--   * a fourth housemate, Kiran, as a placeholder
--   * everyone's joined_on backdated to 1 July 2026, because a split is
--     rejected for anyone who was not living here on the day (0002_invariants)
--   * Ravi away 10-16 August, so you can see the away calendar actually working
--   * 23 expenses across July and August: rent, wifi, electricity, maid, water,
--     a gas cylinder, groceries, vegetables, supplies
--
-- Amounts are chosen so both trend pills on the home card have something to
-- say: August runs above July, and this week runs below last week.
--
-- Pure ASCII, no transaction wrapper, verification at the end -- same rules as
-- the migrations.


-- --------------------------  safety guard  --------------------------

do $$
begin
  if (select count(*) from households) <> 1 then
    raise exception
      'Expected exactly one household, found %. Edit this file to name the one you want.',
      (select count(*) from households);
  end if;
end $$;


-- ------------------  a log, so this is reversible  ------------------

create table if not exists demo_seed_log (
  expense_id uuid primary key
);

-- No policies, so no client can read it. It exists only for the cleanup block.
alter table demo_seed_log enable row level security;
revoke all on demo_seed_log from anon, authenticated;


-- --------------------------  the household  --------------------------

-- A split is refused for anyone who was not resident on the expense date, so
-- July data needs July residents.
update members
   set joined_on = date '2026-07-01'
 where joined_on > date '2026-07-01';

insert into members (household_id, display_name, joined_on, avatar_color)
select h.id, 'Kiran', date '2026-07-01', '#8B6DE0'
  from households h
 where not exists (
   select 1 from members m
    where m.household_id = h.id and m.display_name = 'Kiran'
 );

-- The point of the whole app: day-to-day costs split without Ravi this week,
-- while rent and the maid still split with everyone.
insert into away_periods (household_id, member_id, start_date, end_date, note)
select m.household_id, m.id, date '2026-08-10', date '2026-08-16', 'Home for a week'
  from members m
 where m.display_name = 'Ravi'
   and m.left_on is null
   and not exists (
     select 1 from away_periods a
      where a.member_id = m.id and a.start_date = date '2026-08-10'
   );


-- ---------------------------  the helper  ---------------------------
-- Dropped again at the end of this file. It exists because create_expense()
-- reads auth.uid() to find the caller, and there is no caller in a SQL editor.

create or replace function seed_expense(
  p_category text,
  p_date     date,
  p_payer    text,
  p_rupees   numeric,
  p_desc     text default null
) returns void
language plpgsql as $fn$
declare
  v_house    uuid;
  v_cat      uuid;
  v_respects boolean;
  v_payer    uuid;
  v_total    bigint := round(p_rupees * 100);
  v_expense  uuid;
  v_ids      uuid[];
  v_n        int;
  v_base     bigint;
  v_rem      int;
  v_i        int;
begin
  select id into v_house from households limit 1;

  select id, respects_away_calendar
    into v_cat, v_respects
    from categories
   where household_id = v_house and name = p_category;
  if v_cat is null then
    raise exception 'No category named %', p_category;
  end if;

  select id into v_payer
    from members
   where household_id = v_house and display_name = p_payer and left_on is null;
  if v_payer is null then
    raise exception 'No member named %', p_payer;
  end if;

  -- Who the cost lands on. A fixed or bulk category ignores the away calendar;
  -- a consumption one does not. Payer first, so the odd paisa lands on them,
  -- matching splitEqually() in src/lib/split.ts.
  select array_agg(m.id order by (m.id = v_payer) desc, m.created_at)
    into v_ids
    from members m
   where m.household_id = v_house
     and m.joined_on <= p_date
     and (m.left_on is null or m.left_on >= p_date)
     and (
       not v_respects
       or not exists (
         select 1 from away_periods a
          where a.member_id = m.id
            and p_date >= a.start_date
            and (a.end_date is null or p_date <= a.end_date)
       )
     );

  if v_ids is null then
    raise exception 'Nobody was living here on %', p_date;
  end if;

  -- period_id is left out on purpose: the expenses_set_period BEFORE trigger
  -- derives it from expense_date, and creates the month if it is new.
  insert into expenses (
    household_id, paid_by, total_paise, description, category_id, expense_date, created_by
  )
  values (v_house, v_payer, v_total, p_desc, v_cat, p_date, v_payer)
  returning id into v_expense;

  insert into demo_seed_log (expense_id) values (v_expense);

  v_n    := array_length(v_ids, 1);
  v_base := v_total / v_n;
  v_rem  := (v_total - v_base * v_n)::int;

  for v_i in 1 .. v_n loop
    insert into expense_splits (expense_id, member_id, amount_paise)
    values (v_expense, v_ids[v_i], v_base + case when v_i <= v_rem then 1 else 0 end);
  end loop;
end;
$fn$;


-- ---------------------------  July 2026  ---------------------------
-- Total 38,520.

select seed_expense('Rent',               date '2026-07-01', 'Mohan', 27000, 'July rent');
select seed_expense('Wifi',               date '2026-07-03', 'Ravi',   1200, 'Broadband');
select seed_expense('Electricity',        date '2026-07-05', 'Mani',   2150, null);
select seed_expense('Groceries',          date '2026-07-06', 'Mohan',  1850, 'Monthly stock-up');
select seed_expense('Gas Cylinder',       date '2026-07-08', 'Kiran',  1150, 'New cylinder');
select seed_expense('Vegetables',         date '2026-07-12', 'Mani',    430, null);
select seed_expense('Maid',               date '2026-07-15', 'Mohan',  2000, null);
select seed_expense('Groceries',          date '2026-07-18', 'Ravi',   1240, null);
select seed_expense('Household Supplies', date '2026-07-22', 'Kiran',   680, 'Detergent, phenyl');
select seed_expense('Vegetables',         date '2026-07-26', 'Mani',    520, null);
select seed_expense('Water',              date '2026-07-29', 'Mohan',   300, 'Can delivery');


-- --------------------------  August 2026  --------------------------
-- Total 40,640, so the month trend reads up on July.

select seed_expense('Rent',               date '2026-08-01', 'Mohan', 27000, 'August rent');
select seed_expense('Wifi',               date '2026-08-04', 'Ravi',   1200, 'Broadband');
select seed_expense('Electricity',        date '2026-08-06', 'Mani',   2900, 'Summer bill');
select seed_expense('Groceries',          date '2026-08-09', 'Kiran',  1620, 'Monthly stock-up');

-- Ravi is away 10-16 August. These two split three ways...
select seed_expense('Vegetables',         date '2026-08-12', 'Mohan',   380, null);
select seed_expense('Groceries',          date '2026-08-14', 'Mani',   1100, null);
-- ...but the maid is a fixed cost, so it still splits four ways.
select seed_expense('Maid',               date '2026-08-15', 'Mohan',  2000, null);

select seed_expense('Household Supplies', date '2026-08-20', 'Kiran',   540, null);

-- Monday 24 August. Today is Monday the 31st, so week-to-date is one day and
-- this is the one day it gets compared against.
select seed_expense('Groceries',          date '2026-08-24', 'Ravi',   2240, 'Big shop');
select seed_expense('Vegetables',         date '2026-08-24', 'Mani',    360, null);

-- This week.
select seed_expense('Vegetables',         date '2026-08-31', 'Mohan',   410, null);
select seed_expense('Groceries',          date '2026-08-31', 'Kiran',   890, null);


-- ----------------------------  tidy up  ----------------------------

-- Backdated history should not arrive as 23 unread alerts. Real activity
-- always has an actor; only these trigger-generated rows have none, because
-- current_member() is null with no signed-in caller.
delete from notifications where actor_id is null;

drop function if exists seed_expense(text, date, text, numeric, text);


-- --------------------------  verification  --------------------------

select
  (select count(*) from members where left_on is null)            as members,
  (select count(*) from demo_seed_log)                            as seeded_expenses,
  (select coalesce(sum(total_paise), 0) / 100 from expenses
    where voided_at is null
      and expense_date between date '2026-07-01' and date '2026-07-31') as july_rupees,
  (select coalesce(sum(total_paise), 0) / 100 from expenses
    where voided_at is null
      and expense_date between date '2026-08-01' and date '2026-08-31') as august_rupees,
  (select count(*) = 0 from ledger_imbalance())                   as ledger_balances;

-- Proof the away calendar is doing its job: 12 August splits three ways
-- because Ravi was home, 15 August splits four because rent-like costs do not
-- care where anyone slept.
select
  e.expense_date,
  c.name                    as category,
  c.kind,
  e.total_paise / 100       as rupees,
  count(s.member_id)        as split_between
  from expenses e
  join categories c      on c.id = e.category_id
  left join expense_splits s on s.expense_id = e.id
 where e.expense_date in (date '2026-08-12', date '2026-08-15')
 group by e.id, e.expense_date, c.name, c.kind, e.total_paise
 order by e.expense_date;


-- ==========================  UNDO  ==========================
-- Uncomment and run this to remove everything above. It deletes only the
-- expenses this file created -- expense_splits cascades -- and leaves your
-- own data alone.
--
-- delete from expenses where id in (select expense_id from demo_seed_log);
-- delete from away_periods where start_date = date '2026-08-10';
-- delete from members where display_name = 'Kiran' and user_id is null;
-- delete from notifications where actor_id is null;
-- drop table demo_seed_log;
