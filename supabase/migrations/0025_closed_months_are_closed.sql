-- Roomly -- a closed month actually stays closed.
--
-- period_is_open() is enforced correctly on every ordinary path: the
-- expenses_insert, expenses_owner_update, splits_write and settlements_insert
-- policies all call it (0003_rls.sql:75-124), and period_id is derived
-- server-side by trigger so the client cannot backdate its way in
-- (0002_invariants.sql:34-36).
--
-- Three routes went around all of that.
--
-- 1. review_pending_change() (0004_functions.sql:252, 270-293) is SECURITY
--    DEFINER and updates expenses and expense_splits directly, with no period
--    check at all. close_period() refuses to close WHILE pending changes exist
--    (0004:317-320), but nothing stopped a new one being raised afterwards --
--    pending_insert (0003_rls.sql:170-175) has no period check either. So:
--
--      owner closes March -> member opens a March expense and taps "Request a
--      change" -> owner approves from Home -> a closed month is rewritten.
--
--    The app's only defence was hiding the button client-side
--    (expense/[id].tsx:312), which is not a defence.
--
-- 2. post_recurring_now() -- fixed in 0023, which added the period check there.
--
-- 3. Settlements. settlements_owner_update (0003_rls.sql:126-127) has no
--    period_is_open clause, unlike the expenses policy two blocks above it, so
--    the owner could void a March payment after March was closed. And
--    review_settlement() (0019:162-217) is SECURITY DEFINER, so RLS never saw
--    it at all -- a payment could be CONFIRMED into a sealed month, moving
--    balances the household had already agreed on.
--
--    Reachable on the ordinary path, too, because close_period() said nothing
--    about settlements still awaiting confirmation. Fixed below: you cannot
--    close a month with money still in the air.
--
-- Note on reopen_period(): it exists and is granted (0004:328-338) but has
-- ZERO callers in src/, while expense/[id].tsx:225 tells the user to "reopen
-- the month from Settle up". The app-side half of that is a separate change;
-- this migration only makes sure the door it reopens is the one that matters.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------  1. approvals cannot rewrite a closed month  ---------------

create or replace function review_pending_change(p_change uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_change pending_changes;
  v_split  jsonb;
  v_period uuid;
begin
  select * into v_change from pending_changes where id = p_change;
  if not found then
    raise exception 'No such change';
  end if;
  if v_change.household_id <> current_household() or not is_owner() then
    raise exception 'Only the owner can review changes';
  end if;
  if v_change.status <> 'pending' then
    raise exception 'That change has already been reviewed';
  end if;

  -- The check this function never had. Only APPROVING is gated: rejecting a
  -- stale request against a closed month has to stay possible, or the request
  -- is stuck forever and close_period() below can never succeed again.
  if p_approve and v_change.entity_type = 'expense' then
    select e.period_id into v_period from expenses e where e.id = v_change.entity_id;
    if v_period is not null and not period_is_open(v_period) then
      raise exception
        'That expense is in a closed month. Reopen the month before approving this change.';
    end if;
  end if;

  if p_approve and v_change.entity_type = 'expense' then
    if v_change.kind = 'void' then
      update expenses
         set voided_at = now(), voided_by = current_member(),
             void_reason = coalesce(v_change.reason, p_note)
       where id = v_change.entity_id;
    else
      update expenses
         set total_paise       = coalesce((v_change.payload->>'total_paise')::bigint, total_paise),
             description       = coalesce( v_change.payload->>'description', description),
             category_id       = coalesce((v_change.payload->>'category_id')::uuid, category_id),
             payment_method_id = coalesce((v_change.payload->>'payment_method_id')::uuid, payment_method_id),
             expense_date      = coalesce((v_change.payload->>'expense_date')::date, expense_date),
             -- paid_by was silently dropped: expense/[id].tsx:81-87 lets a
             -- member propose a new payer, and approving it changed everything
             -- except the payer, so the balances moved the wrong way.
             paid_by           = coalesce((v_change.payload->>'paid_by')::uuid, paid_by)
       where id = v_change.entity_id;

      -- Splits are replaced wholesale; the deferred balance trigger checks
      -- the result at commit.
      if v_change.payload ? 'splits' then
        delete from expense_splits where expense_id = v_change.entity_id;
        for v_split in select * from jsonb_array_elements(v_change.payload->'splits') loop
          insert into expense_splits (expense_id, member_id, amount_paise)
          values (v_change.entity_id,
                  (v_split->>'member_id')::uuid,
                  (v_split->>'amount_paise')::bigint);
        end loop;
      end if;
    end if;
  end if;

  update pending_changes
     set status      = case when p_approve then 'approved' else 'rejected' end::change_status,
         reviewed_by = current_member(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_change;
end;
$fn$;

grant execute on function review_pending_change(uuid, boolean, text) to authenticated;


-- ------  and a change cannot be REQUESTED against a closed month either  ------
-- Otherwise the queue fills with requests that can never be approved, and
-- close_period() -- which refuses while any pending change exists -- can never
-- succeed again.

drop policy if exists pending_insert on pending_changes;
create policy pending_insert on pending_changes for insert
  with check (
    household_id = current_household()
    and requested_by = current_member()
    and status = 'pending'
    and (
      entity_type <> 'expense'
      or exists (
        select 1 from expenses e
        where e.id = entity_id and period_is_open(e.period_id)
      )
    )
  );


-- ---------------  3. settlements respect the lock as well  ---------------

drop policy if exists settlements_owner_update on settlements;
create policy settlements_owner_update on settlements for update
  using (
    household_id = current_household()
    and is_owner()
    and period_is_open(period_id)
  );

create or replace function review_settlement(
  p_settlement uuid,
  p_approve    boolean,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_row settlements%rowtype;
begin
  if not is_owner() then
    raise exception 'Only the owner can confirm a payment';
  end if;

  select * into v_row
    from settlements
   where id = p_settlement and household_id = current_household();

  if not found then
    raise exception 'That payment is not in this household';
  end if;

  if v_row.voided_at is not null then
    raise exception 'That payment was already cancelled';
  end if;

  if v_row.confirmed_at is not null then
    -- Idempotent: two taps, or two owners, must not double-apply.
    return;
  end if;

  -- SECURITY DEFINER means RLS is not going to catch this one.
  if not period_is_open(v_row.period_id) then
    raise exception
      'That payment is in a closed month. Reopen the month before confirming it.';
  end if;

  if p_approve then
    update settlements
       set confirmed_at = now(),
           confirmed_by = current_member()
     where id = p_settlement;

    perform notify_household(
      v_row.household_id, 'settlement', p_settlement, v_row.amount_paise,
      (select display_name from members where id = v_row.from_member) || ' -> ' ||
      (select display_name from members where id = v_row.to_member)
    );
  else
    update settlements
       set voided_at = now(),
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
     where id = p_settlement;

    perform notify_household(
      v_row.household_id, 'settlement_rejected', p_settlement, v_row.amount_paise,
      (select display_name from members where id = v_row.from_member) || ' -> ' ||
      (select display_name from members where id = v_row.to_member)
    );
  end if;
end;
$fn$;

grant execute on function review_settlement(uuid, boolean, text) to authenticated;


-- ------------  you cannot close a month with money still in the air  ------------

create or replace function close_period(p_period uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_pending int;
begin
  if not is_owner() then
    raise exception 'Only the owner can close a month';
  end if;
  if not exists (select 1 from periods where id = p_period and household_id = current_household()) then
    raise exception 'No such period in this household';
  end if;
  if exists (select 1 from pending_changes
              where household_id = current_household() and status = 'pending') then
    raise exception 'Resolve the pending changes before closing the month';
  end if;

  -- New. An unconfirmed settlement counts in nobody's balance, so closing the
  -- month over the top of one seals a figure that is about to move the moment
  -- somebody taps confirm.
  select count(*) into v_pending
    from settlements
   where period_id = p_period
     and voided_at is null
     and confirmed_at is null;

  if v_pending > 0 then
    raise exception
      '% payment(s) in this month are still waiting to be confirmed. Confirm or reject them on the Settle screen first.',
      v_pending;
  end if;

  update periods
     set status = 'closed', closed_at = now(), closed_by = current_member()
   where id = p_period;
end;
$fn$;

grant execute on function close_period(uuid) to authenticated;


-- ---------------------------  verification  ---------------------------
-- All five must read true.

select
  (select count(*) from pg_policies
    where tablename = 'settlements' and policyname = 'settlements_owner_update'
      and qual like '%period_is_open%')                      = 1 as settlement_update_locked,
  (select count(*) from pg_policies
    where tablename = 'pending_changes' and policyname = 'pending_insert'
      and with_check like '%period_is_open%')                = 1 as pending_insert_locked,
  (select prosrc like '%closed month%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'review_pending_change')  as approval_locked,
  (select prosrc like '%closed month%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'review_settlement')      as confirm_locked,
  (select count(*) = 0 from ledger_imbalance())                          as ledger_still_balances;
