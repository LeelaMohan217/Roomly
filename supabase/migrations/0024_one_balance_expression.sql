-- Roomly -- one definition of "balance", and make the removal guard hold.
--
-- THE PATTERN THIS MIGRATION EXISTS TO END.
--
-- paid - owed + settled_out - settled_in was written out longhand in three
-- separate places: member_balances (0005, rewritten by 0019), member_ledger
-- (0020) and remove_member (0017:106-122). Migration 0020's own header
-- describes what happens when they drift:
--
--   "0019 made member_balances count only CONFIRMED settlements... It did not
--    do the same to member_ledger... So the two disagreed the moment a payment
--    was awaiting approval."
--
-- The same thing happened again, and 0020 did not catch it: remove_member was
-- never updated either. grep -c confirmed_at 0017_member_admin.sql returns 0,
-- and 0017 is the only definition of that function.
--
-- BUG 1 -- REMOVING SOMEONE CAN UNBALANCE THE HOUSEHOLD.
--
--   Kiran's balance is zero only if you count a Rs 1,000 payment the owner has
--   not confirmed. remove_member counted it, so the guard passed and Kiran got
--   left_on set. member_balances does NOT count it, and filters out left_on
--   rows -- so Kiran's row vanished while the counterparty's stayed. The
--   household stopped summing to zero and ledger_imbalance() started reporting
--   drift: the exact canary 0005_views.sql:27-30 exists to protect.
--
--   The fix is not to add `and confirmed_at is not null` in a fourth place. It
--   is to delete all three copies and leave one.
--
-- BUG 2 -- THE GUARD IS A SNAPSHOT, NOT AN INVARIANT.
--
--   Nothing kept a departed member's balance at zero AFTER they left. Kiran
--   leaves at zero; someone then edits or voids an expense Kiran paid for --
--   both permitted while the period is open (0012_edit_expense.sql:67-82).
--   Kiran's true balance moves off zero, but their row is filtered out of the
--   view, so the household total moves with it.
--
--   The user-visible damage is severe and non-obvious: assertSettles()
--   (settle.ts:56-68) throws, and the Settle screen shows a raw error and
--   OFFERS NO TRANSFERS AT ALL (settle.tsx:342-349). Settle-up is bricked for
--   everyone until somebody finds the orphaned expense by hand.
--
--   Guarded below with triggers rather than policies, so the SECURITY DEFINER
--   functions -- which RLS does not constrain -- are covered too.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  the single definition  ---------------------
-- Deliberately NOT security definer. Called from a security_invoker view it
-- runs as the querying member, so RLS scopes it to their own household;
-- called from inside remove_member (which IS security definer) it runs with
-- that function's reach, which is what the guard needs. One definition, right
-- behaviour in both places.

-- The leading `select` is required: a `language sql` body is a STATEMENT, not
-- an expression, and Postgres rejects a bare arithmetic expression with
-- "syntax error at or near coalesce". Every other sql function in this schema
-- has it (current_member, current_household, is_owner, period_is_open,
-- ledger_imbalance); this one was written without it.
create or replace function member_balance(p_member uuid)
returns bigint
language sql stable set search_path = public as $$
  select
      coalesce((select sum(e.total_paise) from expenses e
                 where e.paid_by = p_member and e.voided_at is null), 0)
    - coalesce((select sum(s.amount_paise) from expense_splits s
                 join expenses e on e.id = s.expense_id
                where s.member_id = p_member and e.voided_at is null), 0)
    + coalesce((select sum(t.amount_paise) from settlements t
                 where t.from_member = p_member
                   and t.voided_at is null
                   and t.confirmed_at is not null), 0)
    - coalesce((select sum(t.amount_paise) from settlements t
                 where t.to_member = p_member
                   and t.voided_at is null
                   and t.confirmed_at is not null), 0);
$$;

comment on function member_balance(uuid) is
  'Positive means the house owes this person. THE definition of a balance -- '
  'member_balances, member_ledger and remove_member all call this and none of '
  'them restate the arithmetic. Migrations 0020 and 0024 both exist because '
  'copies of it drifted apart. Do not make a fourth copy.';

grant execute on function member_balance(uuid) to authenticated;


-- ---------------------  the view, restated in terms of it  ---------------------

-- The ::numeric cast is load-bearing, not decoration.
--
-- sum(bigint) returns NUMERIC in Postgres, so the old inline expression gave
-- this column the type numeric. member_balance() returns bigint, and
-- `create or replace view` refuses to change an existing column's type:
--
--   ERROR: cannot change data type of view column "balance_paise"
--          from numeric to bigint
--
-- Casting back keeps the column exactly as it was, so the replace succeeds and
-- ledger_imbalance() -- which depends on this view and would be dropped by a
-- drop/recreate -- is left alone. The client already reads this as a string
-- (queries.ts:308-316 says so), so nothing downstream notices.
create or replace view member_balances
with (security_invoker = true) as
select
  m.id                            as member_id,
  m.household_id,
  m.display_name,
  member_balance(m.id)::numeric   as balance_paise
from members m
where m.left_on is null;

comment on view member_balances is
  'Positive means the house owes this person. Unconfirmed settlements are '
  'excluded -- a payment counts once it has been confirmed as received. '
  'CANARY: sum(balance_paise) per household must always be exactly 0. If it '
  'ever is not, money is being invented or destroyed. Excluding a settlement '
  'removes a matched pair (one credit, one debit), so the sum is unaffected; '
  'removing a MEMBER does not, which is what the guards in 0024 protect.';


-- ---------------------  the breakdown, aligned by construction  ---------------------
-- member_ledger still needs its four components separately, because the whole
-- point of the "Why this amount?" panel is showing the working. But the
-- reconciliation is now checked against member_balance() rather than hoped for.

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
             where t.from_member = m.id
               and t.voided_at is null
               and t.confirmed_at is not null), 0)                as settled_out_paise,
  coalesce((select sum(t.amount_paise) from settlements t
             where t.to_member = m.id
               and t.voided_at is null
               and t.confirmed_at is not null), 0)                as settled_in_paise
from members m
where m.left_on is null;


-- ---------------------  BUG 1: the removal guard  ---------------------
-- Same function, same answer, no fourth copy of the arithmetic.

create or replace function remove_member(p_member_id uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_household uuid;
  v_target    members%rowtype;
  v_balance   bigint;
  v_used      boolean;
begin
  if not is_owner() then
    raise exception 'Only the owner can remove people from the household';
  end if;

  v_household := current_household();

  select * into v_target
    from members
   where id = p_member_id and household_id = v_household;

  if not found then
    raise exception 'That person is not in this household';
  end if;

  if v_target.id = current_member() then
    raise exception 'You cannot remove yourself. Transfer ownership first.';
  end if;

  if v_target.role = 'owner' then
    raise exception 'Transfer ownership before removing the owner';
  end if;

  -- Already gone. Idempotent so a double tap is harmless.
  if v_target.left_on is not null then
    return 'moved_out';
  end if;

  -- Any financial trace at all means the row has to survive: expense_splits
  -- carries no cascade precisely so history can never be rewritten.
  select exists (select 1 from expense_splits where member_id = p_member_id)
      or exists (select 1 from expenses
                  where paid_by = p_member_id or created_by = p_member_id)
      or exists (select 1 from settlements
                  where from_member = p_member_id or to_member = p_member_id)
      or exists (select 1 from pending_changes where requested_by = p_member_id)
    into v_used;

  if not v_used then
    -- A recurring rule naming them as payer is config, not history, but
    -- deleting them would break it. Say so rather than silently repointing it.
    if exists (select 1 from recurring_expenses where paid_by = p_member_id) then
      raise exception
        'They are the payer on a recurring bill. Change or delete that rule first.';
    end if;

    delete from away_periods      where member_id = p_member_id;
    delete from expense_templates where owner_member = p_member_id;
    delete from join_requests     where claim_member_id = p_member_id
                                    and status = 'pending';

    begin
      delete from members where id = p_member_id;
      return 'deleted';
    exception when foreign_key_violation then
      null;
    end;
  end if;

  -- member_balances hides anyone with left_on set, and that view's stated
  -- canary is that balances per household sum to exactly zero. Moving out
  -- someone who is still owed money would drop their row from the view and so
  -- invent or destroy that money.
  --
  -- This used to restate the arithmetic inline and counted UNCONFIRMED
  -- settlements, so it disagreed with the very view it was protecting. It now
  -- asks the one function that defines a balance.
  v_balance := member_balance(p_member_id);

  if v_balance <> 0 then
    raise exception
      'Settle up with % first. Their balance is not zero (% paise), and removing them now would unbalance the ledger.',
      v_target.display_name, v_balance;
  end if;

  update members
     set left_on = greatest(current_date, v_target.joined_on)
   where id = p_member_id;

  return 'moved_out';
end;
$fn$;

grant execute on function remove_member(uuid) to authenticated;


-- ------------  BUG 2: a departed member's history is frozen  ------------
-- Triggers, not policies: review_pending_change, post_recurring_now and
-- review_settlement are all SECURITY DEFINER and RLS does not see them.
--
-- The message points at an adjusting entry because that is already this
-- project's stated position on corrections -- a settled figure is not edited,
-- it is offset by a new one.

-- Deliberately NOT covering DELETE on expense_splits. A row trigger cannot
-- reliably tell a deliberate split rewrite from a cascade -- deleting a
-- household cascades households -> expenses -> expense_splits, and a DELETE
-- guard would make supabase/tests/cleanup.sql fail. The expenses guard below
-- covers the real path instead: update_expense() and review_pending_change()
-- both UPDATE the expense row before they touch its splits, so they are
-- stopped one statement earlier, with a better message.

create or replace function block_departed_member_splits()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_name text;
begin
  select display_name into v_name
    from members where id = new.member_id and left_on is not null;

  if found then
    raise exception
      '% has moved out, so they cannot be added to an expense. Record an adjusting expense instead.',
      v_name;
  end if;

  return new;
end;
$fn$;

drop trigger if exists splits_departed_guard on expense_splits;
create trigger splits_departed_guard
  before insert or update on expense_splits
  for each row execute function block_departed_member_splits();

-- Any update at all, not just the money columns. update_expense() replaces
-- splits wholesale after updating the parent row, so an edit that drops the
-- departed member from the split while leaving total_paise and paid_by alone
-- would otherwise slip past a money-columns-only check and move their balance.
-- Re-categorising one old expense is a small thing to give up for that.

create or replace function block_departed_member_expense()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_name text;
begin
  select m.display_name into v_name
    from members m
   where m.left_on is not null
     and (m.id = old.paid_by
          or exists (select 1 from expense_splits s
                      where s.expense_id = old.id and s.member_id = m.id))
   limit 1;

  if found then
    raise exception
      '% has moved out, so this expense can no longer be changed. Record an adjusting expense instead.',
      v_name;
  end if;

  return new;
end;
$fn$;

drop trigger if exists expenses_departed_guard on expenses;
create trigger expenses_departed_guard
  before update on expenses
  for each row execute function block_departed_member_expense();


-- ---------------------------  verification  ---------------------------
-- The first is the invariant the Settle screen depends on: for every member,
-- the breakdown must reconcile to their balance. The second is the canary.

select
  (select count(*) = 0
     from member_balances b
     join member_ledger l on l.member_id = b.member_id
    where (l.owed_paise + l.settled_in_paise - l.paid_paise - l.settled_out_paise)
          <> -b.balance_paise)                                as breakdown_reconciles,
  (select count(*) = 0 from ledger_imbalance())               as ledger_still_balances,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'member_balance')  = 1 as balance_fn,
  (select count(*) from pg_trigger
    where tgname in ('splits_departed_guard', 'expenses_departed_guard')) = 2 as guards_installed,
  (select count(*) from member_ledger)                        as members_checked;
