-- Roomly -- make the server agree with the calendar on the wall.
--
-- `show timezone` on this project returns UTC. IST is UTC+05:30, so between
-- 00:00 and 05:30 India time the server's current_date is YESTERDAY, while
-- every date the app sends is device-local and correct:
--
--   src/lib/dates.ts:1-7  "Calendar dates are plain 'YYYY-MM-DD' strings
--   throughout the app, never Date objects... they can't drift across midnight
--   the way a UTC timestamp does -- 11pm IST is already tomorrow in UTC, which
--   would put an expense in the wrong day and, at month end, the wrong period."
--
-- The client got that exactly right and then five server functions reached for
-- current_date anyway, so the two halves disagreed for five and a half hours
-- out of every twenty-four. What that actually costs:
--
--   post_recurring_now      a "varies" bill entered at 2am on the 1st is dated
--                           the previous month -- which, since 0025, is very
--                           likely CLOSED, so it now throws instead
--   post_due_recurrences    computes its whole window a month early across the
--                           month boundary
--   record_settlement       only a latent trap today (settle.tsx passes
--                           todayIso() explicitly), but the default is wrong
--   remove_member           marks left_on as yesterday, which can retroactively
--                           invalidate that day's splits against
--                           check_split_residency
--   add_placeholder_member  a housemate added at 2am joins a day early (the one
--                           harmless case -- earlier is always safe)
--
-- TWO FIXES, DELIBERATELY BOTH.
--
--   1. The database timezone is set to the household's, so current_date,
--      column defaults (members.joined_on, settlements.settled_on) and any
--      ad-hoc query in the SQL editor are all right by default.
--
--   2. The five functions ask household_today() explicitly, so ledger
--      correctness does not depend on a session GUC that a different
--      connection path, a pooler, or a restored backup could fail to apply.
--      Money is not the place to rely on a setting being inherited.
--
-- The timezone is stored per household rather than hardcoded, alongside
-- `currency`, which is already per household for the same reason.
--
-- No signature changes, so this needs no new APK.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  where a household lives  ---------------------

alter table households add column if not exists timezone text not null default 'Asia/Kolkata';

comment on column households.timezone is
  'IANA zone deciding what "today" means for this household. The app sends '
  'device-local dates (src/lib/dates.ts), so the server has to agree or the '
  'two drift for the offset every night. Sits beside `currency` because it is '
  'the same kind of fact.';


-- ---------------------  the one definition of "today"  ---------------------
-- Leading `select` because a `language sql` body is a statement, not an
-- expression -- the mistake that made 0024 fail on its first apply.

create or replace function household_today(p_household uuid default null)
returns date
language sql stable set search_path = public as $$
  select (now() at time zone coalesce(
    (select h.timezone from households h where h.id = p_household),
    'Asia/Kolkata'
  ))::date;
$$;

comment on function household_today(uuid) is
  'Today, on the household''s own calendar. Use this instead of current_date '
  'anywhere a CALENDAR DAY is being decided -- what month a bill belongs to, '
  'when somebody moved out. current_date is UTC on this project and is a day '
  'behind for the first five and a half hours of every Indian morning.';

grant execute on function household_today(uuid) to authenticated;


-- ------------  and the default for everything that is not a function  ------------
-- Belt to the braces above: column defaults and hand-written SQL cannot call
-- household_today(), so the server's own idea of today is corrected too.
-- Done dynamically because the database name is not portable.

do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Kolkata');
end
$$;


-- ---------------------  the five callers  ---------------------

-- 1. Posting a recurring bill. p_date now defaults to NULL and is resolved
--    against the rule's own household, which current_date could not do.
create or replace function post_recurring_now(
  p_recurring uuid,
  p_amount    bigint default null,
  p_date      date default null
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
  v_when         date;
  v_year         smallint;
  v_month        smallint;
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

  v_when  := coalesce(p_date, household_today(r.household_id));
  v_year  := extract(year  from v_when)::smallint;
  v_month := extract(month from v_when)::smallint;

  if not r.is_active then
    raise exception 'That recurring bill is paused. Resume it before posting.';
  end if;

  v_amount := coalesce(p_amount, r.amount_paise);
  if v_amount is null or v_amount <= 0 then
    raise exception 'This recurring expense needs an amount';
  end if;

  v_period := ensure_period(r.household_id, v_when);
  if not period_is_open(v_period) then
    raise exception 'That month is closed. Reopen it before posting into it.';
  end if;

  -- Claim the month before writing anything: a concurrent caller blocks here
  -- on the primary key, then finds zero rows inserted and returns our expense
  -- rather than writing a second one. (Migration 0023.)
  insert into recurring_postings (recurring_id, year, month, expense_id)
  values (p_recurring, v_year, v_month, null)
  on conflict (recurring_id, year, month) do nothing;

  if not found then
    select rp.expense_id into v_expense
      from recurring_postings rp
     where rp.recurring_id = p_recurring and rp.year = v_year and rp.month = v_month;
    return v_expense;
  end if;

  select array_agg(m.id order by m.created_at)
    into v_residents
    from members m
   where m.household_id = r.household_id
     and m.joined_on <= v_when
     and (m.left_on is null or m.left_on >= v_when);

  if v_residents is null or array_length(v_residents, 1) = 0 then
    raise exception 'Nobody was living here on % - cannot split', v_when;
  end if;

  if r.away_aware then
    select array_agg(m.id order by m.created_at)
      into v_participants
      from members m
     where m.id = any(v_residents)
       and not exists (
         select 1 from away_periods a
          where a.member_id = m.id
            and v_when >= a.start_date
            and (a.end_date is null or v_when <= a.end_date)
       );
  else
    v_participants := v_residents;
  end if;

  -- Never an empty split: mirrors defaultParticipants() in split.ts:44-46.
  if v_participants is null or array_length(v_participants, 1) = 0 then
    v_participants := v_residents;
  end if;

  -- Payer first, then created_at order -- matching splitEqually().
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
    r.category_id, v_when, r.created_by
  )
  returning id into v_expense;

  for v_i in 1..v_n loop
    insert into expense_splits (expense_id, member_id, amount_paise)
    values (v_expense, v_ordered[v_i], v_base + (case when v_i <= v_rem then 1 else 0 end));
  end loop;

  update recurring_postings
     set expense_id = v_expense
   where recurring_id = p_recurring and year = v_year and month = v_month;

  return v_expense;
end;
$fn$;


-- 2. The catch-up sweep.
create or replace function post_due_recurrences()
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_house  uuid := current_household();
  v_today  date;
  r        record;
  v_cursor date;
  v_first  date;
  v_due    date;
  v_count  int := 0;
begin
  if v_house is null then
    return 0;
  end if;

  v_today := household_today(v_house);

  for r in
    select re.id, re.day_of_month, re.created_at
      from recurring_expenses re
     where re.household_id = v_house
       and re.is_active
       and re.mode = 'auto'
       and re.amount_paise is not null
  loop
    -- Never walk back more than a year: a household dormant for longer should
    -- enter the gap deliberately rather than have twelve rents appear at once.
    v_first := greatest(
      date_trunc('month', r.created_at)::date,
      date_trunc('month', v_today - interval '11 months')::date
    );
    v_cursor := v_first;

    while v_cursor <= date_trunc('month', v_today)::date loop
      -- Clamped to the length of THIS month, so a rule set to the 31st posts
      -- on the 28th or 30th rather than never. Two separate intervals: a
      -- signed unit inside one literal is parsed at runtime.
      v_due := make_date(
        extract(year  from v_cursor)::int,
        extract(month from v_cursor)::int,
        least(
          r.day_of_month,
          extract(day from (date_trunc('month', v_cursor)
                            + interval '1 month' - interval '1 day'))::int
        )
      );

      if v_due <= v_today and v_due >= r.created_at::date and not exists (
        select 1 from recurring_postings rp
         where rp.recurring_id = r.id
           and rp.year  = extract(year  from v_due)::smallint
           and rp.month = extract(month from v_due)::smallint
      ) then
        -- One rule must never take the others down with it.
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


-- 3. Recording a payment.
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

  if not exists (select 1 from members where id = p_from and household_id = v_house) then
    raise exception 'The payer is not a member of this household';
  end if;
  if not exists (select 1 from members where id = p_to and household_id = v_house) then
    raise exception 'The payee is not a member of this household';
  end if;

  if not is_owner() and v_me <> p_from and v_me <> p_to then
    raise exception 'You can only record a payment you are part of';
  end if;

  -- member_balance() is positive when the house owes this person, so a payer
  -- at or above zero is being asked to pay a debt they do not have.
  v_balance := member_balance(p_from);

  if v_balance >= 0 then
    raise exception
      '% does not owe anything right now, so recording a payment from them would make the ledger wrong in the other direction. Did you mean % paid % instead?',
      (select display_name from members where id = p_from),
      (select display_name from members where id = p_to),
      (select display_name from members where id = p_from);
  end if;

  v_when := coalesce(p_date, household_today(v_house));
  perform ensure_period(v_house, v_when);

  insert into settlements (
    household_id, from_member, to_member, amount_paise, settled_on, note, created_by,
    confirmed_at, confirmed_by
  )
  values (
    v_house, p_from, p_to, p_amount, v_when,
    nullif(trim(coalesce(p_note, '')), ''), v_me,
    -- The payee saying "I got it" IS the confirmation.
    case when v_me = p_to then now() else null end,
    case when v_me = p_to then v_me  else null end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function record_settlement(uuid, uuid, bigint, date, text) to authenticated;


-- 4. Moving somebody out. A left_on dated yesterday can retroactively
--    invalidate that day's splits against check_split_residency.
create or replace function remove_member(p_member_id uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_household uuid;
  v_target    members%rowtype;
  v_balance   bigint;
  v_used      boolean;
begin
  if not is_owner() then
    raise exception 'Only the owner can remove people from the household';
  end if;

  v_household := current_household();

  select * into v_target
    from members
   where id = p_member_id and household_id = v_household;

  if not found then
    raise exception 'That person is not in this household';
  end if;

  if v_target.id = current_member() then
    raise exception 'You cannot remove yourself. Transfer ownership first.';
  end if;

  if v_target.role = 'owner' then
    raise exception 'Transfer ownership before removing the owner';
  end if;

  if v_target.left_on is not null then
    return 'moved_out';
  end if;

  select exists (select 1 from expense_splits where member_id = p_member_id)
      or exists (select 1 from expenses
                  where paid_by = p_member_id or created_by = p_member_id)
      or exists (select 1 from settlements
                  where from_member = p_member_id or to_member = p_member_id)
      or exists (select 1 from pending_changes where requested_by = p_member_id)
    into v_used;

  if not v_used then
    if exists (select 1 from recurring_expenses where paid_by = p_member_id) then
      raise exception
        'They are the payer on a recurring bill. Change or delete that rule first.';
    end if;

    delete from away_periods      where member_id = p_member_id;
    delete from expense_templates where owner_member = p_member_id;
    delete from join_requests     where claim_member_id = p_member_id
                                    and status = 'pending';

    begin
      delete from members where id = p_member_id;
      return 'deleted';
    exception when foreign_key_violation then
      null;
    end;
  end if;

  -- One definition of a balance (migration 0024). Do not restate it.
  v_balance := member_balance(p_member_id);

  if v_balance <> 0 then
    raise exception
      'Settle up with % first. Their balance is not zero (% paise), and removing them now would unbalance the ledger.',
      v_target.display_name, v_balance;
  end if;

  update members
     set left_on = greatest(household_today(v_household), v_target.joined_on)
   where id = p_member_id;

  return 'moved_out';
end;
$fn$;

grant execute on function remove_member(uuid) to authenticated;


-- 5. Adding a housemate who was already living here.
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
  -- arrivals -- the usual reason to add one is catching the app up.
  select created_at::date into v_start from households where id = v_household;

  insert into members (household_id, display_name, invited_email, joined_on)
  values (
    v_household, p_name, p_email,
    coalesce(p_joined_on, v_start, household_today(v_household))
  )
  returning id into v_member;

  return v_member;
end;
$fn$;

grant execute on function add_placeholder_member(text, text, date) to authenticated;


-- ---------------------------  verification  ---------------------------
-- The first six must read true. `server_today` and `household_today` should
-- read the same date -- and if you are running this between 00:00 and 05:30
-- IST, they would have DIFFERED before this migration, which is the whole
-- point. The database-level timezone only takes effect on a NEW connection,
-- so `session_timezone` may still say UTC in this tab; open a new SQL Editor
-- tab to see it change. household_today() does not depend on it either way.

select
  (select count(*) from information_schema.columns
    where table_name = 'households' and column_name = 'timezone')          = 1 as timezone_column,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'household_today')          = 1 as today_fn,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('post_recurring_now', 'post_due_recurrences',
                        'record_settlement', 'remove_member', 'add_placeholder_member')
      and p.prosrc like '%household_today%')                               = 5 as all_five_converted,
  (select count(*) = 0 from ledger_imbalance())                                as ledger_still_balances,
  (select count(*) = 0
     from member_balances b join member_ledger l on l.member_id = b.member_id
    where (l.owed_paise + l.settled_in_paise - l.paid_paise - l.settled_out_paise)
          <> -b.balance_paise)                                                 as breakdown_reconciles,
  (select h.timezone from households h limit 1)                                as household_zone,
  household_today((select id from households limit 1))                         as household_today,
  current_date                                                                 as server_today,
  current_setting('TimeZone')                                                  as session_timezone;
