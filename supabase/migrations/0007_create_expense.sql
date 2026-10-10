-- Writing an expense has to be ATOMIC.
--
-- The obvious client code -- insert the expense, then insert its splits -- is
-- two separate transactions. If the second call fails (dropped signal, app
-- killed), the first has already committed and you are left with an expense
-- that nobody owes anything on. The payer gets credited, no one gets debited,
-- and sum(balances) is no longer zero.
--
-- Worse, the old check_expense_balance() let that through on purpose: it
-- skipped the check when a expense had no splits at all. That escape hatch is
-- removed below. The trigger is DEFERRED, so by commit time the splits of a
-- legitimate insert already exist -- an expense with no splits can only mean
-- the write was half-finished.

begin;

create or replace function check_expense_balance()
returns trigger language plpgsql as $$
declare
  v_sum bigint;
begin
  select coalesce(sum(amount_paise), 0) into v_sum
    from expense_splits where expense_id = new.id;

  if v_sum <> new.total_paise then
    raise exception
      'Split imbalance on expense %: splits sum to % paise, total is % paise',
      new.id, v_sum, new.total_paise;
  end if;
  return null;
end;
$$;

-- Runs as the CALLER (security invoker), so every RLS policy still applies:
-- you can only write into your own household, as yourself, in an open month.
create or replace function create_expense(
  p_total_paise    bigint,
  p_category       uuid,
  p_expense_date   date,
  p_paid_by        uuid,
  p_splits         jsonb,          -- [{"member_id": "...", "amount_paise": 3334}]
  p_description    text default null,
  p_payment_method uuid default null
) returns uuid
language plpgsql as $$
declare
  v_me      uuid := current_member();
  v_house   uuid := current_household();
  v_expense uuid;
  v_split   jsonb;
  v_sum     bigint := 0;
begin
  if v_me is null then
    raise exception 'You are not a member of any household';
  end if;

  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'An expense needs at least one participant';
  end if;

  -- Fail fast with a clear message rather than letting the trigger fire a
  -- more cryptic one at commit.
  select sum((s->>'amount_paise')::bigint) into v_sum
    from jsonb_array_elements(p_splits) s;

  if v_sum <> p_total_paise then
    raise exception 'Splits sum to % paise but the total is % paise', v_sum, p_total_paise;
  end if;

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

grant execute on function
  create_expense(bigint, uuid, date, uuid, jsonb, text, uuid)
to authenticated;

commit;
