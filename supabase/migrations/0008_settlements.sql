-- Settling up needs two things the schema didn't have yet.

begin;

-- 1. Settlements must belong to a month, derived server-side from the date --
--    same rule as expenses. Without this the client supplies period_id, which
--    means a client could file a settlement into whichever period it liked.
create or replace function set_settlement_period()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_period uuid;
begin
  insert into periods (household_id, year, month)
  values (
    new.household_id,
    extract(year  from new.settled_on)::smallint,
    extract(month from new.settled_on)::smallint
  )
  on conflict (household_id, year, month)
    do update set household_id = excluded.household_id
  returning id into v_period;

  new.period_id := v_period;
  return new;
end;
$$;

create trigger settlements_set_period
  before insert or update of settled_on on settlements
  for each row execute function set_settlement_period();

-- 2. The numbers behind a balance.
--
--    Debt simplification tells Ravi "pay Arjun Rs 600" when the two of them
--    never shared an expense. That is mathematically right and feels wrong,
--    and it is the single most confusing thing about Splitwise. This view
--    backs the "why do I owe this?" breakdown so the number can always be
--    taken apart.
create or replace view member_ledger
with (security_invoker = true) as
select
  m.id           as member_id,
  m.household_id,
  m.display_name,
  coalesce((select sum(e.total_paise) from expenses e
             where e.paid_by = m.id and e.voided_at is null), 0)  as paid_paise,
  coalesce((select count(*) from expenses e
             where e.paid_by = m.id and e.voided_at is null), 0)  as paid_count,
  coalesce((select sum(s.amount_paise) from expense_splits s
             join expenses e on e.id = s.expense_id
            where s.member_id = m.id and e.voided_at is null), 0) as owed_paise,
  coalesce((select count(*) from expense_splits s
             join expenses e on e.id = s.expense_id
            where s.member_id = m.id and e.voided_at is null), 0) as owed_count,
  coalesce((select sum(t.amount_paise) from settlements t
             where t.from_member = m.id and t.voided_at is null), 0) as settled_out_paise,
  coalesce((select sum(t.amount_paise) from settlements t
             where t.to_member = m.id and t.voided_at is null), 0)   as settled_in_paise
from members m
where m.left_on is null;

commit;
