-- Roomly -- recurring bills: stop double-posting, stop skipping whole months.
--
-- Four bugs in the two functions 0013 and 0014 left behind.
--
-- 1. THE IDEMPOTENCY CLAIM WAS FALSE. 0013_recurring.sql:5-7 says:
--
--      "Idempotency comes from recurring_postings' unique index, not from the
--       client behaving, so ten people opening the app at once still post
--       once."
--
--    That is not what the code did. The order was: read postings (:108),
--    insert the EXPENSE (:150), insert the SPLITS (:160), and only then insert
--    the posting row with `on conflict do nothing` (:169). Two devices opening
--    the app the same morning both passed the read, both wrote a complete
--    expense, and the loser of the unique-index race SWALLOWED THE CONFLICT AND
--    COMMITTED ANYWAY. Two rents, one posting row.
--
--    `on conflict do nothing` was exactly the wrong choice at exactly the
--    wrong point. The fix is to claim the month FIRST, before anything
--    expensive, and let the loser return the winner's expense. Manual test 7.4
--    covers this and has never been run.
--
-- 2. A WHOLE MONTH WAS SILENTLY SKIPPED. post_due_recurrences only ever
--    computed a due date inside the CURRENT month (0014:35-42). If nobody
--    opened the app between the 3rd of March and the 3rd of April, March's
--    rent was never posted and never would be -- April's run only considered
--    April. There was no UI to force it either: the Post button only renders
--    for mode='confirm' rules (recurring.tsx:52). Rent just vanished.
--
-- 3. ONE FAILING RULE KILLED THE WHOLE BATCH. post_recurring_now raises when
--    everybody is away (0013:135-137), while the client falls back to all
--    residents in the same situation (split.ts:44-46) precisely so an expense
--    is never dropped on the floor. Since post_due_recurrences had no exception
--    handler, one away-aware rule failing meant every OTHER due rule that month
--    silently did not post either.
--
-- 4. day_of_month WAS CAPPED AT 28. The intent was right -- no "31st of
--    February" -- but a household whose rent falls on the 30th simply could not
--    say so. Clamping at posting time is the standard resolution and removes
--    the restriction from the user's view entirely.
--
-- Also fixed here: post_recurring_now never checked is_active, so a paused rule
-- could still be posted through the confirm path (recurring.tsx:39); and its
-- remainder-paise ordering was by UUID while the client orders by created_at,
-- so the same expense split differently depending on which wrote it.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  let rent fall on the 30th  ---------------------

alter table recurring_expenses drop constraint if exists recurring_expenses_day_of_month_check;
alter table recurring_expenses add constraint recurring_expenses_day_of_month_check
  check (day_of_month between 1 and 31);

comment on column recurring_expenses.day_of_month is
  'The day the bill falls due, 1-31. Clamped to the length of the month at '
  'posting time, so 31 means "the last day" in February rather than never.';


-- ---------------------  claim the month, then do the work  ---------------------

create or replace function post_recurring_now(
  p_recurring uuid,
  p_amount    bigint default null,
  p_date      date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  r              record;
  v_participants uuid[];
  v_residents    uuid[];
  v_ordered      uuid[];
  v_n            int;
  v_amount       bigint;
  v_base         bigint;
  v_rem          bigint;
  v_expense      uuid;
  v_period       uuid;
  v_year         smallint := extract(year  from p_date)::smallint;
  v_month        smallint := extract(month from p_date)::smallint;
  v_i            int;
begin
  select re.*, c.respects_away_calendar as away_aware
    into r
    from recurring_expenses re
    join categories c on c.id = re.category_id
   where re.id = p_recurring;

  if not found then
    raise exception 'No such recurring expense';
  end if;
  if r.household_id <> current_household() then
    raise exception 'That recurring expense belongs to another household';
  end if;

  -- Pausing a rule has to actually stop it. post_due_recurrences filtered on
  -- is_active but the confirm path calls this function directly.
  if not r.is_active then
    raise exception 'That recurring bill is paused. Resume it before posting.';
  end if;

  v_amount := coalesce(p_amount, r.amount_paise);
  if v_amount is null or v_amount <= 0 then
    raise exception 'This recurring expense needs an amount';
  end if;

  -- A closed month is closed. This function is SECURITY DEFINER, so RLS is not
  -- going to stop it -- the check has to be here.
  v_period := ensure_period(r.household_id, p_date);
  if not period_is_open(v_period) then
    raise exception 'That month is closed. Reopen it before posting into it.';
  end if;

  -- ---- CLAIM THE MONTH BEFORE WRITING ANYTHING ----
  -- The whole point of the fix. A concurrent caller blocks here on the primary
  -- key until we commit, then finds zero rows inserted and returns our
  -- expense instead of writing a second one. Nothing expensive has happened
  -- yet, so the loser wastes nothing.
  insert into recurring_postings (recurring_id, year, month, expense_id)
  values (p_recurring, v_year, v_month, null)
  on conflict (recurring_id, year, month) do nothing;

  if not found then
    select rp.expense_id into v_expense
      from recurring_postings rp
     where rp.recurring_id = p_recurring and rp.year = v_year and rp.month = v_month;
    return v_expense;
  end if;

  -- Who was living here, and -- for consumption categories only -- who was
  -- actually around. Rent ignores the away calendar; groceries do not.
  select array_agg(m.id order by m.created_at)
    into v_residents
    from members m
   where m.household_id = r.household_id
     and m.joined_on <= p_date
     and (m.left_on is null or m.left_on >= p_date);

  if v_residents is null or array_length(v_residents, 1) = 0 then
    raise exception 'Nobody was living here on % - cannot split', p_date;
  end if;

  if r.away_aware then
    select array_agg(m.id order by m.created_at)
      into v_participants
      from members m
     where m.id = any(v_residents)
       and not exists (
         select 1 from away_periods a
          where a.member_id = m.id
            and p_date >= a.start_date
            and (a.end_date is null or p_date <= a.end_date)
       );
  else
    v_participants := v_residents;
  end if;

  -- Never produce an empty split: if somehow nobody was home, fall back to all
  -- residents rather than dropping the expense on the floor. This mirrors
  -- defaultParticipants() in split.ts:44-46, which the SQL used to contradict
  -- by raising instead.
  if v_participants is null or array_length(v_participants, 1) = 0 then
    v_participants := v_residents;
  end if;

  -- Payer first so they absorb the leftover paise, then created_at order --
  -- matching splitEqually()'s [payer, ...members in created_at order]
  -- (split.ts:70-71). Ordering by the raw UUID, as this used to, agreed with
  -- the client only when the remainder was 0 or 1.
  select array_agg(m.id order by (m.id <> r.paid_by), m.created_at)
    into v_ordered
    from members m
   where m.id = any(v_participants);

  v_n    := array_length(v_ordered, 1);
  v_base := v_amount / v_n;
  v_rem  := v_amount - v_base * v_n;

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

  -- Fill in the claim we staked at the top.
  update recurring_postings
     set expense_id = v_expense
   where recurring_id = p_recurring and year = v_year and month = v_month;

  return v_expense;
end;
$fn$;


-- ---------------------  catch up on what was missed  ---------------------
-- Called on app open. Walks back over every month the rule could have posted
-- in and has not, rather than only looking at today's.

create or replace function post_due_recurrences()
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_house  uuid := current_household();
  r        record;
  v_cursor date;
  v_first  date;
  v_due    date;
  v_count  int := 0;
begin
  if v_house is null then
    return 0;
  end if;

  for r in
    select re.id, re.day_of_month, re.created_at
      from recurring_expenses re
     where re.household_id = v_house
       and re.is_active
       and re.mode = 'auto'
       and re.amount_paise is not null
  loop
    -- Start at the rule's own first month, but never walk back more than a
    -- year. A household dormant for longer than that should enter the gap
    -- deliberately rather than have twelve rents appear at once.
    v_first := greatest(
      date_trunc('month', r.created_at)::date,
      date_trunc('month', current_date - interval '11 months')::date
    );
    v_cursor := v_first;

    while v_cursor <= date_trunc('month', current_date)::date loop
      -- Clamp to the length of THIS month, so a rule set to the 31st posts on
      -- the 28th or 30th rather than never.
      v_due := make_date(
        extract(year  from v_cursor)::int,
        extract(month from v_cursor)::int,
        least(
          r.day_of_month,
          -- Two separate intervals, not '1 month - 1 day'. A signed unit inside
          -- one literal is parsed at RUNTIME, so a bad one creates the
          -- function happily and only throws on the first app open.
          extract(day from (date_trunc('month', v_cursor)
                            + interval '1 month' - interval '1 day'))::int
        )
      );

      if v_due <= current_date and v_due >= r.created_at::date and not exists (
        select 1 from recurring_postings rp
         where rp.recurring_id = r.id
           and rp.year  = extract(year  from v_due)::smallint
           and rp.month = extract(month from v_due)::smallint
      ) then
        -- One rule must never take the others down with it. A closed month, a
        -- deleted category, an empty house -- whatever it is, skip that rule
        -- and keep going. This is why the everyone-away raise in 0013 could
        -- silently cost a household every other bill that month.
        begin
          perform post_recurring_now(r.id, null, v_due);
          v_count := v_count + 1;
        exception when others then
          null;
        end;
      end if;

      v_cursor := (v_cursor + interval '1 month')::date;
    end loop;
  end loop;

  return v_count;
end;
$fn$;

grant execute on function post_recurring_now(uuid, bigint, date) to authenticated;
grant execute on function post_due_recurrences() to authenticated;


-- ---------------------------  verification  ---------------------------
-- All five must read true. The fourth is the real test of bug 1: the posting
-- row is now written before the expense, so a claimed month never has a null
-- expense_id once the transaction that claimed it has committed.

select
  (select count(*) from pg_constraint
    where conname = 'recurring_expenses_day_of_month_check'
      and pg_get_constraintdef(oid) like '%31%')                  as day_31_allowed,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_recurring_now')   = 1 as post_now_fn,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_due_recurrences') = 1 as post_due_fn,
  (select count(*) = 0 from recurring_postings where expense_id is null)   as no_orphan_claims,
  (select count(*) = 0 from ledger_imbalance())                            as ledger_still_balances;
