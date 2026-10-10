-- Fix: a new recurring rule back-posted into the month it was created in.
--
-- post_due_recurrences() posts on the rule's due day. Create a rule on the
-- 31st with day_of_month = 1 and it immediately posts an expense dated the
-- 1st -- a month you have probably already recorded by hand, split across
-- whoever happened to live there then. In a brand new household it fails
-- outright with "Nobody was living here on <date>", because nobody had
-- joined yet.
--
-- A rule should only ever post from its first occurrence AFTER it was
-- created. Backfilling a past month is a deliberate act, not something a
-- schedule should do on your behalf.

create or replace function post_due_recurrences()
returns int
language plpgsql security definer set search_path = public as $fn$
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
    select re.id, re.day_of_month, re.created_at
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

    -- Not due yet this month.
    continue when v_due > current_date;

    -- Due day already passed before this rule existed: skip it and start
    -- next month.
    continue when v_due < r.created_at::date;

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
$fn$;

grant execute on function post_due_recurrences() to authenticated;

-- Confirms it worked: should be true.
select pg_get_functiondef(p.oid) like '%created_at::date%' as start_date_guard_applied
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'post_due_recurrences';
