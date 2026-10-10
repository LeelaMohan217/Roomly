-- Editing and voiding an expense.
--
-- Both are SECURITY INVOKER, so RLS decides who may do what:
--   * the expenses UPDATE policy allows the owner only, in an open month
--   * members get a permission error, which is the app's cue to raise a
--     pending_change for approval instead
--
-- Replacing splits has to be atomic with the amount change, or the deferred
-- balance trigger would fire against a half-updated expense.
--
-- No transaction wrapper: every statement is CREATE OR REPLACE or a GRANT,
-- so a failure stops visibly instead of silently rolling back the lot.

create or replace function update_expense(
  p_expense        uuid,
  p_total_paise    bigint,
  p_category       uuid,
  p_expense_date   date,
  p_paid_by        uuid,
  p_splits         jsonb,
  p_description    text default null,
  p_payment_method uuid default null
) returns void
language plpgsql as $fn$
declare
  v_split jsonb;
  v_sum   bigint;
begin
  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'An expense needs at least one participant';
  end if;

  select sum((s->>'amount_paise')::bigint) into v_sum
    from jsonb_array_elements(p_splits) s;

  if v_sum <> p_total_paise then
    raise exception 'Splits sum to % paise but the total is % paise', v_sum, p_total_paise;
  end if;

  -- If the date moved into a different month, that month must exist first.
  perform ensure_period(current_household(), p_expense_date);

  update expenses
     set total_paise       = p_total_paise,
         category_id       = p_category,
         expense_date      = p_expense_date,
         paid_by           = p_paid_by,
         description       = nullif(trim(coalesce(p_description, '')), ''),
         payment_method_id = p_payment_method
   where id = p_expense;

  if not found then
    raise exception 'That expense could not be updated - it may be in a closed month';
  end if;

  delete from expense_splits where expense_id = p_expense;

  for v_split in select * from jsonb_array_elements(p_splits) loop
    insert into expense_splits (expense_id, member_id, amount_paise)
    values (p_expense, (v_split->>'member_id')::uuid, (v_split->>'amount_paise')::bigint);
  end loop;
end;
$fn$;

-- Soft delete. Financial records are never actually removed - a voided
-- expense drops out of every balance but its history stays readable.
create or replace function void_expense(p_expense uuid, p_reason text default null)
returns void
language plpgsql as $fn$
begin
  update expenses
     set voided_at   = now(),
         voided_by   = current_member(),
         void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_expense
     and voided_at is null;

  if not found then
    raise exception 'That expense could not be deleted - it may already be deleted, or in a closed month';
  end if;
end;
$fn$;

create or replace function unvoid_expense(p_expense uuid)
returns void
language plpgsql as $fn$
begin
  update expenses
     set voided_at = null, voided_by = null, void_reason = null
   where id = p_expense;

  if not found then
    raise exception 'That expense could not be restored';
  end if;
end;
$fn$;

grant execute on function update_expense(uuid, bigint, uuid, date, uuid, jsonb, text, uuid) to authenticated;
grant execute on function void_expense(uuid, text) to authenticated;
grant execute on function unvoid_expense(uuid) to authenticated;

-- Confirms it worked: all three should be true.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_expense')  = 1 as update_expense_created,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'void_expense')    = 1 as void_expense_created,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'unvoid_expense')  = 1 as unvoid_expense_created;
