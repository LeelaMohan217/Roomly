-- Roomly -- derived reads.
-- Balances are NEVER stored. Storing them means an edit three days later
-- needs reverse-and-reapply logic, and it will drift. Four people and a few
-- thousand rows recompute instantly.

begin;

create or replace view member_balances
with (security_invoker = true) as
select
  m.id           as member_id,
  m.household_id,
  m.display_name,
    coalesce((select sum(e.total_paise) from expenses e
               where e.paid_by = m.id and e.voided_at is null), 0)
  - coalesce((select sum(s.amount_paise) from expense_splits s
               join expenses e2 on e2.id = s.expense_id
              where s.member_id = m.id and e2.voided_at is null), 0)
  + coalesce((select sum(t.amount_paise) from settlements t
               where t.from_member = m.id and t.voided_at is null), 0)
  - coalesce((select sum(t.amount_paise) from settlements t
               where t.to_member = m.id and t.voided_at is null), 0)
    as balance_paise
from members m
where m.left_on is null;

comment on view member_balances is
  'Positive means the house owes this person. CANARY: sum(balance_paise) '
  'per household must always be exactly 0. If it ever is not, money is '
  'being invented or destroyed -- check the split balance trigger.';

-- What the Reports screen runs.
create or replace view monthly_category_totals
with (security_invoker = true) as
select
  e.household_id,
  p.year,
  p.month,
  c.id   as category_id,
  c.name as category_name,
  c.kind,
  sum(e.total_paise) as total_paise,
  count(*)           as expense_count
from expenses e
join periods    p on p.id = e.period_id
join categories c on c.id = e.category_id
where e.voided_at is null
group by e.household_id, p.year, p.month, c.id, c.name, c.kind;

-- The health check to run after every sync. Should always return no rows.
create or replace function ledger_imbalance()
returns table (household_id uuid, drift_paise bigint)
language sql stable security definer set search_path = public as $$
  select b.household_id, sum(b.balance_paise)
    from member_balances b
   group by b.household_id
  having sum(b.balance_paise) <> 0;
$$;

commit;
