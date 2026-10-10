-- Roomly -- refuse a payment recorded the wrong way round.
--
-- record_settlement has never compared the direction against anybody's
-- balance. It checks that the two people are different, that the amount is
-- positive, that both are in your household (0026), and that you are one of
-- them -- and then books it.
--
-- So "I paid Ravi", recorded by someone who did not owe Ravi anything, does
-- not correct a debt. It CREATES one, in the wrong direction, and the ledger
-- swallows it silently because the numbers still sum to zero. Two people then
-- argue about a figure that is confidently wrong, which is the specific failure
-- this whole app exists to prevent.
--
-- The rule: you cannot record money going OUT from someone who does not owe
-- anything. If the payer's confirmed balance is zero or positive, the house
-- owes THEM -- a payment from them makes the house owe them more still.
--
-- Deliberately not a `p_force` escape hatch. There is no in-app path that
-- produces such a row: the Settle screen only ever offers transfers from
-- simplifyDebts(), which always run debtor -> creditor. Anything reaching this
-- branch is either a mis-tap or a hand-rolled RPC call, and both should stop.
-- If a household ever finds a genuine case, that is a deliberate change with a
-- reason, not a flag added in advance for a use nobody has.
--
-- Note this is checked against the CONFIRMED balance, the same figure the
-- Settle screen plans from. Using an unconfirmed one would refuse a second
-- legitimate payment while the first was still awaiting the payee.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


create or replace function record_settlement(
  p_from   uuid,
  p_to     uuid,
  p_amount bigint,
  p_date   date default current_date,
  p_note   text default null
) returns uuid
language plpgsql as $fn$
declare
  v_me      uuid := current_member();
  v_house   uuid := current_household();
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

  -- The direction check. member_balance() is positive when the house owes
  -- this person, so a payer at or above zero is being asked to pay a debt
  -- they do not have.
  v_balance := member_balance(p_from);

  if v_balance >= 0 then
    raise exception
      '% does not owe anything right now, so recording a payment from them would make the ledger wrong in the other direction. Did you mean % paid % instead?',
      (select display_name from members where id = p_from),
      (select display_name from members where id = p_to),
      (select display_name from members where id = p_from);
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


-- ---------------------------  verification  ---------------------------
-- All four must read true. The second is the substance of the change.

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')     = 1 as one_record_fn,
  (select prosrc like '%member_balance(p_from)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')          as direction_checked,
  (select prosrc like '%not a member of this household%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_settlement')          as parties_still_scoped,
  (select count(*) = 0 from ledger_imbalance())                              as ledger_still_balances;
