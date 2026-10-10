-- Roomly -- the person who received the money is the one who confirms it.
--
-- 0019 introduced confirmation, and made it owner-only (0019:167-170). That put
-- the wrong person in the loop. When Ravi pays Priya, the one who knows whether
-- the money actually arrived is PRIYA. Under the old rule the owner was asked to
-- vouch for a transfer they were not part of and have no evidence about, while
-- Priya -- who can just look at her bank app -- had no say at all.
--
-- "Confirmed" is supposed to mean "received". Now it does.
--
--   * The PAYEE confirms or rejects.
--   * The OWNER keeps the same power, as an override -- somebody has to be able
--     to unstick a household whose payee is on a trek, and a placeholder member
--     with no app account (members.user_id is null, which is the normal state
--     before a flatmate installs the app) cannot confirm for themselves at all.
--   * A payment the payee RECORDS themselves is confirmed on the spot, on the
--     same reasoning 0019:146-148 used for the owner: asking someone to approve
--     their own entry is theatre. Note this is now narrower than before -- an
--     owner recording a payment between two OTHER people no longer
--     self-confirms it, because they are not the one who received it.
--
-- confirmed_by already records who confirmed, so the audit trail needs no
-- change and existing history keeps its meaning.
--
-- Also fixed here, same file because it is the same function: record_settlement
-- never checked that p_from and p_to are in your household. Both go straight
-- into the insert guarded only by the global FK to members(id), and
-- member_balance() sums a member's settlements with no household filter -- so a
-- foreign member id lands in THEIR household's balances and breaks THEIR
-- zero-sum canary. Same hole 0022 closed on the expense side.
--
-- NOT changed here: notifications are household-wide (0015:12-25 has no target
-- column), so 'settlement_pending' still reaches everyone. The subject line
-- below says who owes the confirmation, and usePendingSettlements() separates
-- "waiting on you" from "waiting on them" client-side. Per-member notification
-- targeting would also mean reworking the push fan-out in 0016 -- a separate
-- change, deliberately not bundled into this one.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


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

  -- Both parties must be ours. Without this, a payment could be booked against
  -- someone in another household and quietly unbalance their ledger.
  if not exists (select 1 from members where id = p_from and household_id = v_house) then
    raise exception 'The payer is not a member of this household';
  end if;
  if not exists (select 1 from members where id = p_to and household_id = v_house) then
    raise exception 'The payee is not a member of this household';
  end if;

  -- A member may only record a payment they are actually part of. Without
  -- this, anyone could log a payment between two other people.
  if not is_owner() and v_me <> p_from and v_me <> p_to then
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
    -- The payee saying "I got it" IS the confirmation. Anyone else recording
    -- it -- including the owner -- is making a claim the payee has to agree to.
    case when v_me = p_to then now() else null end,
    case when v_me = p_to then v_me  else null end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function record_settlement(uuid, uuid, bigint, date, text) to authenticated;


-- ---------------------  who is being asked  ---------------------
-- The subject now names the person the confirmation is waiting on, since the
-- notification itself goes to the whole household.

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
    case
      when new.confirmed_at is null
        then coalesce(v_from, '?') || ' -> ' || coalesce(v_to, '?')
             || ' - waiting on ' || coalesce(v_to, '?')
      else coalesce(v_from, '?') || ' -> ' || coalesce(v_to, '?')
    end
  );
  return null;
end;
$fn$;


-- ---------------------  confirming or rejecting one  ---------------------

create or replace function review_settlement(
  p_settlement uuid,
  p_approve    boolean,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_row settlements%rowtype;
  v_me  uuid := current_member();
begin
  select * into v_row
    from settlements
   where id = p_settlement and household_id = current_household();

  if not found then
    raise exception 'That payment is not in this household';
  end if;

  -- The change this migration is for. The payee decides; the owner can step in
  -- when the payee is a placeholder with no account, or is simply unreachable.
  if v_me <> v_row.to_member and not is_owner() then
    raise exception
      'Only the person who was paid can confirm this, or the household owner.';
  end if;

  if v_row.voided_at is not null then
    raise exception 'That payment was already cancelled';
  end if;

  if v_row.confirmed_at is not null then
    -- Idempotent: two taps, or the payee and the owner at once, must not
    -- double-apply.
    return;
  end if;

  -- SECURITY DEFINER means RLS is not going to catch this one. (Added in 0025;
  -- restated here because this migration replaces the whole function.)
  if not period_is_open(v_row.period_id) then
    raise exception
      'That payment is in a closed month. Reopen the month before confirming it.';
  end if;

  if p_approve then
    update settlements
       set confirmed_at = now(),
           confirmed_by = v_me
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

grant execute on function review_settlement(uuid, boolean, text) to authenticated;


-- ---------------------------  verification  ---------------------------
-- All five must read true. The second is the substance of the change: the
-- function no longer refuses everyone who is not the owner.

select
  (select prosrc like '%to_member%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'review_settlement')      as payee_can_confirm,
  (select prosrc not like '%Only the owner can confirm%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'review_settlement')      as owner_only_gone,
  (select prosrc like '%not a member of this household%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')      as parties_scoped,
  (select count(*) = 0
     from member_balances b
     join member_ledger l on l.member_id = b.member_id
    where (l.owed_paise + l.settled_in_paise - l.paid_paise - l.settled_out_paise)
          <> -b.balance_paise)                                           as breakdown_reconciles,
  (select count(*) = 0 from ledger_imbalance())                          as ledger_still_balances;
