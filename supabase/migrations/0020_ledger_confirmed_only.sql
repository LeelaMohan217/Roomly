-- Roomly -- make "Why this amount?" agree with the amount again.
--
-- A bug introduced by 0019. That migration made member_balances count only
-- CONFIRMED settlements, which is what makes owner approval mean anything. It
-- did not do the same to member_ledger -- the sibling view behind the
-- breakdown panel on the Settle screen.
--
-- So the two disagreed the moment a payment was awaiting approval:
--
--   card header  (member_balances, confirmed only) : pay Rs 15,033
--   breakdown    (member_ledger, all settlements)  : owes overall Rs 14,033
--
-- ...on the one screen whose entire purpose is justifying that number. The
-- panel showed "Already paid others + Rs 1,000" for money the balance had
-- deliberately not counted yet.
--
-- Only settle.tsx reads member_ledger, and only to explain a balance, so
-- aligning it with member_balances is the whole fix. No app change needed.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


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
  -- confirmed_at: the two filters below are the entire point of this migration.
  coalesce((select sum(t.amount_paise) from settlements t
             where t.from_member = m.id
               and t.voided_at is null
               and t.confirmed_at is not null), 0)                as settled_out_paise,
  coalesce((select sum(t.amount_paise) from settlements t
             where t.to_member = m.id
               and t.voided_at is null
               and t.confirmed_at is not null), 0)                as settled_in_paise
from members m
where m.left_on is null;

comment on view member_ledger is
  'The four numbers behind one balance, for the "Why this amount?" panel. '
  'Counts confirmed settlements only, exactly as member_balances does -- if '
  'the two ever diverge, the breakdown stops adding up to the balance it is '
  'explaining. See the reconciliation check in migration 0020.';


-- ---------------------------  verification  ---------------------------
-- The first column is the real test, and it is the invariant the UI depends
-- on: for every member, the breakdown must reconcile to their balance.
--
--   owed + received - paid - paid_out  ==  -balance
--
-- Run this again any time either view is touched.

select
  (select count(*) = 0
     from member_balances b
     join member_ledger l on l.member_id = b.member_id
    where (l.owed_paise + l.settled_in_paise - l.paid_paise - l.settled_out_paise)
          <> -b.balance_paise)                            as breakdown_reconciles,
  (select count(*) = 0 from ledger_imbalance())           as ledger_still_balances,
  (select count(*) from member_ledger)                    as members_checked;
