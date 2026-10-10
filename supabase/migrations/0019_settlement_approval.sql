-- Roomly -- payments need the owner's confirmation, and ownership can be handed over.
--
-- Two changes:
--
-- 1. Marking a payment no longer moves the ledger on its own. A member records
--    it, the owner confirms it actually arrived, and only then does it count.
--    The owner's own payments confirm immediately -- asking someone to approve
--    themselves is theatre.
--
-- 2. transfer_ownership(), so the household is not stuck when the owner is
--    away. A plain handover: the new owner can hand it straight back.
--
-- The invariant to keep an eye on: member_balances must still sum to exactly
-- zero per household. It does, because an unconfirmed settlement is excluded
-- from BOTH sides -- the payer's credit and the payee's debit -- so filtering
-- it out removes a matched pair rather than one half of one.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  a settlement can now be pending  ---------------------

alter table settlements add column if not exists confirmed_at timestamptz;
alter table settlements add column if not exists confirmed_by uuid references members(id);

-- Everything recorded before this migration was recorded under the old rules,
-- where marking paid WAS the confirmation. Retroactively unconfirming real
-- history would silently rewrite everyone's balance.
update settlements
   set confirmed_at = coalesce(confirmed_at, created_at),
       confirmed_by = coalesce(confirmed_by, created_by)
 where confirmed_at is null;

create index if not exists settlements_pending_idx
  on settlements (household_id)
  where confirmed_at is null and voided_at is null;


-- ---------------------  balances count confirmed money only  ----------------

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
               where t.from_member = m.id
                 and t.voided_at is null
                 and t.confirmed_at is not null), 0)
  - coalesce((select sum(t.amount_paise) from settlements t
               where t.to_member = m.id
                 and t.voided_at is null
                 and t.confirmed_at is not null), 0)
    as balance_paise
from members m
where m.left_on is null;

comment on view member_balances is
  'Positive means the house owes this person. Unconfirmed settlements are '
  'excluded -- a payment counts once the owner has confirmed it arrived. '
  'CANARY: sum(balance_paise) per household must always be exactly 0. If it '
  'ever is not, money is being invented or destroyed -- check the split '
  'balance trigger. Excluding a settlement removes a matched pair (one '
  'credit, one debit), so the sum is unaffected.';


-- ---------------------  new notification kinds  ---------------------

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in (
    'expense_added', 'expense_changed', 'expense_deleted',
    'settlement', 'settlement_pending', 'settlement_rejected',
    'member_added', 'member_joined', 'ownership_transferred'
  ));

-- A pending payment is addressed at the owner; a confirmed one is news for
-- everyone. Same trigger, different kind.
create or replace function notify_settlement()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_from text;
  v_to   text;
begin
  select display_name into v_from from members where id = new.from_member;
  select display_name into v_to   from members where id = new.to_member;

  perform notify_household(
    new.household_id,
    case when new.confirmed_at is null then 'settlement_pending' else 'settlement' end,
    new.id,
    new.amount_paise,
    coalesce(v_from, '?') || ' -> ' || coalesce(v_to, '?')
  );
  return null;
end;
$fn$;


-- ---------------------  recording a payment  ---------------------

create or replace function record_settlement(
  p_from   uuid,
  p_to     uuid,
  p_amount bigint,
  p_date   date default current_date,
  p_note   text default null
) returns uuid
language plpgsql as $fn$
declare
  v_me    uuid := current_member();
  v_house uuid := current_household();
  v_owner boolean := is_owner();
  v_id    uuid;
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

  -- A member may only record a payment they are actually part of. Without
  -- this, anyone could log a payment between two other people.
  if not v_owner and v_me <> p_from and v_me <> p_to then
    raise exception 'You can only record a payment you are part of';
  end if;

  perform ensure_period(v_house, p_date);

  insert into settlements (
    household_id, from_member, to_member, amount_paise, settled_on, note, created_by,
    confirmed_at, confirmed_by
  )
  values (
    v_house, p_from, p_to, p_amount, p_date,
    nullif(trim(coalesce(p_note, '')), ''), v_me,
    -- The owner confirming their own entry is not a second pair of eyes.
    case when v_owner then now() else null end,
    case when v_owner then v_me else null end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function record_settlement(uuid, uuid, bigint, date, text) to authenticated;


-- ---------------------  confirming or rejecting one  ---------------------

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
    -- Rejected rather than deleted, so the attempt stays in the history.
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


-- ---------------------  handing ownership over  ---------------------
-- members_owner_remains is a DEFERRED constraint trigger, so the moment
-- between demoting one owner and promoting the next is never observed.

create or replace function transfer_ownership(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_me     uuid := current_member();
  v_house  uuid := current_household();
  v_target members%rowtype;
begin
  if not is_owner() then
    raise exception 'Only the owner can hand ownership over';
  end if;

  select * into v_target
    from members
   where id = p_member_id and household_id = v_house and left_on is null;

  if not found then
    raise exception 'That person is not in this household';
  end if;

  if v_target.id = v_me then
    raise exception 'You are already the owner';
  end if;

  -- A placeholder has nobody behind it to sign in and use the powers.
  if v_target.user_id is null then
    raise exception
      'They have not claimed their account yet, so they cannot take over. Send them an invite code first.';
  end if;

  update members set role = 'member' where id = v_me;
  update members set role = 'owner'  where id = p_member_id;

  perform notify_household(
    v_house, 'ownership_transferred', p_member_id, null, v_target.display_name
  );
end;
$fn$;


-- ---------------------------  verification  ---------------------------
-- Every column must read true.

select
  (select count(*) from information_schema.columns
    where table_name = 'settlements' and column_name = 'confirmed_at') = 1
      as confirmed_at_exists,
  (select count(*) from pg_proc where proname = 'review_settlement') = 1
      as review_settlement_exists,
  (select count(*) from pg_proc where proname = 'transfer_ownership') = 1
      as transfer_ownership_exists,
  (select count(*) from settlements where confirmed_at is null and voided_at is null) = 0
      as existing_payments_all_confirmed,
  (select count(*) = 0 from ledger_imbalance())
      as ledger_still_balances;
