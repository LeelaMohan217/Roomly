-- Roomly -- a housemate approves an expense before it counts.
--
-- Until now an expense moved everyone's balance the moment it was saved. A
-- payment already works the other way (0026): it counts once the person who
-- received it says so. This does the same for expenses -- somebody other than
-- the person who entered it has to look at it first.
--
-- THE RULES, as agreed with the household:
--
--   * A new expense is 'pending' and counts in NO balance, total, report or
--     statement until it is 'approved'. That includes one queued offline: it
--     is pending from the moment it syncs, like any other.
--   * Whoever ADDED it can never approve it. Not even the owner.
--   * Anyone else in the split may approve or reject. If nobody else in the
--     split has an app account (placeholders cannot tap anything), any other
--     member may. The owner may always step in on somebody else's expense --
--     the same override 0026 kept for payments.
--   * Recurring bills that post themselves are approved on arrival: somebody
--     agreed to the rule once, and asking every month is noise.
--   * A household where nobody else has an account approves on arrival too,
--     because nobody ever could.
--   * Rejecting VOIDS it, like a rejected payment: it stays in History marked
--     rejected, with the reason, and never counts.
--   * If the person who added it later changes the amount, the payer or the
--     split themselves, it goes back to pending. Otherwise Rs 10 could be
--     approved and then edited to Rs 10,000 inside the self-edit window (0031).
--     Description, category and date edits leave it approved. Restoring a
--     rejected expense sends it back for approval rather than straight in.
--   * Every expense that exists before this migration is approved.
--
-- HOW IT HOLDS, whatever a client sends:
--
--   expense_approval_guard (BEFORE INSERT OR UPDATE on expenses) decides the
--   status of a new row and refuses any approval change a client makes
--   directly. It tells a client from server code by current_user: a request
--   from the app runs as 'authenticated' (create_expense and update_expense
--   are SECURITY INVOKER), while post_recurring_now and review_expense are
--   SECURITY DEFINER and run as the function owner. So recurring posts need no
--   change at all, and the only way to approve is review_expense().
--
--   A client may do exactly one thing to the status itself: move its OWN
--   approved expense back to pending. That is what the splits trigger below
--   does when the person who added it rewrites the split.
--
-- WHAT COUNTS is now `voided_at is null and approval_status = 'approved'` in
-- member_balance(), member_ledger and monthly_category_totals. member_balance()
-- is still the one definition of a balance (0024); member_ledger restates its
-- parts for the breakdown and the reconciliation check at the bottom proves
-- the two still agree.
--
-- ALSO HERE, because a pending expense is a new kind of loose end: a month
-- cannot close over one (close_period), and nobody can move out while they
-- are on one (remove_member) -- 0024's departed guard would freeze it.
--
-- ORDER OF RELEASE: apply this BEFORE publishing the app update. The new app
-- filters on approval_status and would fail against a database without it.
-- Phones still on the old app after this runs keep working; their client-side
-- month totals will include pending expenses until they update.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------------  the state  ---------------------------

-- Added with default 'approved' so every existing row is approved in the same
-- statement, then the default flips for everything written from now on.
alter table expenses add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending', 'approved', 'rejected'));
alter table expenses alter column approval_status set default 'pending';

alter table expenses add column if not exists reviewed_by uuid references members(id);
alter table expenses add column if not exists reviewed_at timestamptz;

comment on column expenses.approval_status is
  'pending: entered, counts nowhere yet. approved: counts. rejected: a housemate '
  'said no; always voided too. Changed only by review_expense() and by the '
  'guard trigger -- see 0039.';
comment on column expenses.reviewed_by is
  'Who approved or rejected it. Null for rows approved automatically (recurring '
  'posts, single-account households) and for everything before 0039.';


-- ---------------------------  the guard  ---------------------------
-- NOT security definer: it needs the CALLER's current_user to tell the app
-- from server code. Its reads of members and expense_splits run under the
-- caller's RLS, which is scoped to their own household -- the only one it asks
-- about.

create or replace function expense_needs_a_reviewer(p_household uuid, p_created_by uuid)
returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from members m
     where m.household_id = p_household
       and m.id <> p_created_by
       and m.user_id is not null
       and m.left_on is null
  );
$$;

comment on function expense_needs_a_reviewer(uuid, uuid) is
  'Whether anybody besides the person who added an expense could approve it. '
  'False in a household where everyone else is a placeholder.';

-- The guard and the splits trigger run as the caller, so the caller needs
-- this. It answers only about the caller's own household: RLS on members.
grant execute on function expense_needs_a_reviewer(uuid, uuid) to authenticated;

create or replace function expense_approval_guard()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_client boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if not v_client or not expense_needs_a_reviewer(new.household_id, new.created_by) then
      new.approval_status := 'approved';
      new.reviewed_at     := now();
    else
      new.approval_status := 'pending';
      new.reviewed_at     := null;
    end if;
    new.reviewed_by := null;
    return new;
  end if;

  -- UPDATE. First, what the client itself asked for.

  -- created_by decides who may approve, so it must not move. expenses_insert
  -- pins it on the way in (0003), but expenses_update (0031) lets the owner
  -- write any column -- and an owner who repointed their own expense at a
  -- housemate could then approve it themselves.
  if v_client and new.created_by is distinct from old.created_by then
    raise exception 'Who added an expense cannot be changed.';
  end if;

  if v_client and (new.approval_status, new.reviewed_by, new.reviewed_at)
                  is distinct from (old.approval_status, old.reviewed_by, old.reviewed_at) then
    -- The one change a client may make: its own approved expense back to
    -- pending (the splits trigger below, after a split rewrite).
    if not (old.approval_status = 'approved'
            and new.approval_status = 'pending'
            and new.reviewed_by is null
            and new.reviewed_at is null
            and old.created_by = current_member()) then
      raise exception 'An expense is approved or rejected from its screen, by a housemate.';
    end if;
  end if;

  -- Then what follows from the edit. The person who added it changing the
  -- money sends it back for approval.
  if old.approval_status = 'approved'
     and new.voided_at is null
     and (new.total_paise <> old.total_paise or new.paid_by <> old.paid_by)
     and old.created_by = current_member()
     and expense_needs_a_reviewer(new.household_id, new.created_by) then
    new.approval_status := 'pending';
    new.reviewed_by     := null;
    new.reviewed_at     := null;
  end if;

  -- Restoring a rejected expense asks again rather than slipping it in.
  if old.approval_status = 'rejected' and old.voided_at is not null and new.voided_at is null then
    new.approval_status := 'pending';
    new.reviewed_by     := null;
    new.reviewed_at     := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists expenses_approval_guard on expenses;
create trigger expenses_approval_guard
  before insert or update on expenses
  for each row execute function expense_approval_guard();


-- A split rewrite by the person who added it -- same total, different shares
-- -- moves money just as much as a new total does. Row-level, invoker: it
-- runs as the caller, so the guard above sees a client and allows only the
-- step back to pending. create_expense writes splits onto a pending row and
-- recurring posts run as the owner, so neither is touched.
create or replace function expense_splits_need_review()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_expense uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return null;
  end if;

  -- Branch on the operation rather than coalesce(new, old): NEW is not a
  -- usable row in a DELETE trigger, and referencing it there is an error
  -- waiting on the Postgres version.
  if tg_op = 'DELETE' then
    v_expense := old.expense_id;
  else
    v_expense := new.expense_id;
  end if;

  update expenses e
     set approval_status = 'pending', reviewed_by = null, reviewed_at = null
   where e.id = v_expense
     and e.approval_status = 'approved'
     and e.voided_at is null
     and e.created_by = current_member()
     and expense_needs_a_reviewer(e.household_id, e.created_by);

  return null;
end;
$fn$;

drop trigger if exists splits_need_review on expense_splits;
create trigger splits_need_review
  after insert or update or delete on expense_splits
  for each row execute function expense_splits_need_review();


-- update_expense used to delete and rewrite every split on every save, so a
-- description fix would look like a split change to the trigger above. It
-- now leaves identical splits alone. Otherwise unchanged from 0012.
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

  if exists (
       select s.member_id, s.amount_paise from expense_splits s where s.expense_id = p_expense
       except
       select (j->>'member_id')::uuid, (j->>'amount_paise')::bigint from jsonb_array_elements(p_splits) j
     )
     or exists (
       select (j->>'member_id')::uuid, (j->>'amount_paise')::bigint from jsonb_array_elements(p_splits) j
       except
       select s.member_id, s.amount_paise from expense_splits s where s.expense_id = p_expense
     ) then
    delete from expense_splits where expense_id = p_expense;

    for v_split in select * from jsonb_array_elements(p_splits) loop
      insert into expense_splits (expense_id, member_id, amount_paise)
      values (p_expense, (v_split->>'member_id')::uuid, (v_split->>'amount_paise')::bigint);
    end loop;
  end if;
end;
$fn$;

grant execute on function update_expense(uuid, bigint, uuid, date, uuid, jsonb, text, uuid) to authenticated;


-- ---------------------  who may review this one  ---------------------
-- One definition, used by review_expense AND selected by the app as a computed
-- column, so a button that appears will work -- the can_edit_now pattern (0031).

create or replace function can_review_expense(e expenses)
returns boolean
language sql stable set search_path = public as $$
  select
    e.approval_status = 'pending'
    and e.voided_at is null
    and period_is_open(e.period_id)
    and current_member() is not null
    and current_member() <> e.created_by
    and (
      is_owner()
      or exists (select 1 from expense_splits s
                  where s.expense_id = e.id and s.member_id = current_member())
      or not exists (select 1 from expense_splits s
                       join members m on m.id = s.member_id
                      where s.expense_id = e.id
                        and s.member_id <> e.created_by
                        and m.user_id is not null
                        and m.left_on is null)
    );
$$;

comment on function can_review_expense(expenses) is
  'Whether the caller may approve or reject this expense now. Never the person '
  'who added it; anyone else in the split; any other member when nobody else '
  'in the split has an account; the owner always.';

grant execute on function can_review_expense(expenses) to authenticated;


create or replace function review_expense(
  p_expense uuid,
  p_approve boolean,
  p_note    text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_row expenses%rowtype;
  v_me  uuid := current_member();
begin
  select * into v_row
    from expenses
   where id = p_expense and household_id = current_household();

  if not found then
    raise exception 'That expense is not in this household';
  end if;

  -- Idempotent: two housemates tapping at once must not double-apply, and the
  -- second one should not see an error for agreeing with the first.
  if v_row.approval_status = 'approved' and p_approve then
    return;
  end if;
  if v_row.approval_status = 'rejected' and not p_approve then
    return;
  end if;

  if v_row.voided_at is not null then
    raise exception 'That expense was deleted';
  end if;
  if v_row.approval_status <> 'pending' then
    raise exception 'That expense has already been reviewed';
  end if;

  if v_me = v_row.created_by then
    raise exception 'Someone else has to approve an expense you added.';
  end if;

  -- SECURITY DEFINER, so RLS will not catch a closed month here.
  if not period_is_open(v_row.period_id) then
    raise exception
      'That expense is in a closed month. Reopen the month before reviewing it.';
  end if;

  if not can_review_expense(v_row) then
    raise exception
      'Only someone in this split can approve it, or the household owner.';
  end if;

  if p_approve then
    update expenses
       set approval_status = 'approved',
           reviewed_by     = v_me,
           reviewed_at     = now()
     where id = p_expense;
  else
    -- Rejected rather than deleted, so the attempt stays in the history.
    update expenses
       set approval_status = 'rejected',
           reviewed_by     = v_me,
           reviewed_at     = now(),
           voided_at       = now(),
           voided_by       = v_me,
           void_reason     = nullif(trim(coalesce(p_note, '')), '')
     where id = p_expense;
  end if;
end;
$fn$;

grant execute on function review_expense(uuid, boolean, text) to authenticated;


-- ---------------------  what counts  ---------------------
-- member_balance() keeps its signature, its comment and its confirmed-only
-- settlements; only the two expense sums gain the approval filter.

create or replace function member_balance(p_member uuid)
returns bigint
language sql stable set search_path = public as $$
  select
      coalesce((select sum(e.total_paise) from expenses e
                 where e.paid_by = p_member
                   and e.voided_at is null
                   and e.approval_status = 'approved'), 0)
    - coalesce((select sum(s.amount_paise) from expense_splits s
                 join expenses e on e.id = s.expense_id
                where s.member_id = p_member
                  and e.voided_at is null
                  and e.approval_status = 'approved'), 0)
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
  'them restate the arithmetic. Counts approved expenses (0039) and confirmed '
  'settlements (0019) only. Migrations 0020 and 0024 both exist because copies '
  'of it drifted apart. Do not make a fourth copy.';

grant execute on function member_balance(uuid) to authenticated;

create or replace view member_ledger
with (security_invoker = true) as
select
  m.id           as member_id,
  m.household_id,
  m.display_name,
  coalesce((select sum(e.total_paise) from expenses e
             where e.paid_by = m.id and e.voided_at is null
               and e.approval_status = 'approved'), 0)               as paid_paise,
  coalesce((select count(*) from expenses e
             where e.paid_by = m.id and e.voided_at is null
               and e.approval_status = 'approved'), 0)               as paid_count,
  coalesce((select sum(s.amount_paise) from expense_splits s
             join expenses e on e.id = s.expense_id
            where s.member_id = m.id and e.voided_at is null
              and e.approval_status = 'approved'), 0)                as owed_paise,
  coalesce((select count(*) from expense_splits s
             join expenses e on e.id = s.expense_id
            where s.member_id = m.id and e.voided_at is null
              and e.approval_status = 'approved'), 0)                as owed_count,
  coalesce((select sum(t.amount_paise) from settlements t
             where t.from_member = m.id
               and t.voided_at is null
               and t.confirmed_at is not null), 0)                   as settled_out_paise,
  coalesce((select sum(t.amount_paise) from settlements t
             where t.to_member = m.id
               and t.voided_at is null
               and t.confirmed_at is not null), 0)                   as settled_in_paise
from members m
where m.left_on is null;

-- What Reports runs.
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
  and e.approval_status = 'approved'
group by e.household_id, p.year, p.month, c.id, c.name, c.kind;


-- ---------------------  indexes for the new shapes  ---------------------
-- member_balance(): the payer sum now filters on approval too. The 0038 index
-- would still find the rows but fetch each one to read the status; this one
-- answers from the index. It replaces 0038's expenses_paid_by_total_idx.
create index if not exists expenses_paid_by_counted_idx
  on expenses (paid_by) include (total_paise)
  where voided_at is null and approval_status = 'approved';
drop index if exists expenses_paid_by_total_idx;

-- Home's "Needs you": expenses waiting on somebody, oldest first.
create index if not exists expenses_pending_idx
  on expenses (household_id, created_at)
  where approval_status = 'pending' and voided_at is null;


-- ---------------------  a month cannot close over a pending one  ------------
-- Same reasoning as 0025's payment check: a pending expense counts nowhere, so
-- closing the month over it seals a figure that moves the moment someone taps
-- Approve -- and then nobody could, because the month is closed.

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

  select count(*) into v_pending
    from expenses
   where period_id = p_period
     and voided_at is null
     and approval_status = 'pending';

  if v_pending > 0 then
    raise exception
      '% expense(s) in this month are still waiting for approval. Approve or reject them first.',
      v_pending;
  end if;

  update periods
     set status = 'closed', closed_at = now(), closed_by = current_member()
   where id = p_period;
end;
$fn$;

grant execute on function close_period(uuid) to authenticated;


-- ---------------  nobody moves out from under a pending expense  ---------------
-- 0024's expenses_departed_guard refuses ANY update to an expense that names
-- someone who has moved out. A pending expense counts in nobody's balance, so
-- the balance check below would let them go -- and then that expense could be
-- neither approved, rejected nor deleted, and close_period above would refuse
-- its month forever. So: decide it first. Otherwise 0030's version, unchanged.

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

  if v_target.left_on is not null then
    return 'moved_out';
  end if;

  select exists (select 1 from expense_splits where member_id = p_member_id)
      or exists (select 1 from expenses
                  where paid_by = p_member_id or created_by = p_member_id)
      or exists (select 1 from settlements
                  where from_member = p_member_id or to_member = p_member_id)
      or exists (select 1 from pending_changes where requested_by = p_member_id)
    into v_used;

  if not v_used then
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

  if exists (
    select 1 from expenses e
     where e.approval_status = 'pending'
       and e.voided_at is null
       and (e.paid_by = p_member_id
            or e.created_by = p_member_id
            or exists (select 1 from expense_splits s
                        where s.expense_id = e.id and s.member_id = p_member_id))
  ) then
    raise exception
      '% is on an expense still waiting for approval. Approve or reject it first.',
      v_target.display_name;
  end if;

  -- One definition of a balance (migration 0024). Do not restate it.
  v_balance := member_balance(p_member_id);

  if v_balance <> 0 then
    raise exception
      'Settle up with % first. Their balance is not zero (% paise), and removing them now would unbalance the ledger.',
      v_target.display_name, v_balance;
  end if;

  update members
     set left_on = greatest(household_today(v_household), v_target.joined_on)
   where id = p_member_id;

  return 'moved_out';
end;
$fn$;

grant execute on function remove_member(uuid) to authenticated;


-- ---------------------------  telling people  ---------------------------

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in (
    'expense_added', 'expense_changed', 'expense_deleted',
    'expense_pending', 'expense_approved', 'expense_rejected',
    'settlement', 'settlement_pending', 'settlement_rejected',
    'member_added', 'member_joined', 'ownership_transferred'
  ));

-- 0015's trigger, with the approval states. A pending expense is announced as
-- waiting rather than added, since it does not count yet; a rejection is
-- announced as a rejection rather than a deletion.
create or replace function notify_expense()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_label text;
begin
  select coalesce(nullif(trim(coalesce(new.description, '')), ''), c.name)
    into v_label
    from categories c where c.id = new.category_id;

  if tg_op = 'INSERT' then
    perform notify_household(
      new.household_id,
      case when new.approval_status = 'pending' then 'expense_pending' else 'expense_added' end,
      new.id, new.total_paise, v_label);
  elsif old.approval_status <> 'rejected' and new.approval_status = 'rejected' then
    perform notify_household(new.household_id, 'expense_rejected', new.id, new.total_paise, v_label);
  elsif old.voided_at is null and new.voided_at is not null then
    perform notify_household(new.household_id, 'expense_deleted', new.id, new.total_paise, v_label);
  elsif old.approval_status = 'pending' and new.approval_status = 'approved' then
    perform notify_household(new.household_id, 'expense_approved', new.id, new.total_paise, v_label);
  elsif old.approval_status <> 'pending' and new.approval_status = 'pending' then
    -- Edited back into review, or a rejected one restored.
    perform notify_household(new.household_id, 'expense_pending', new.id, new.total_paise, v_label);
  elsif old.total_paise <> new.total_paise or old.category_id <> new.category_id then
    -- Only a meaningful change is worth interrupting people for.
    perform notify_household(new.household_id, 'expense_changed', new.id, new.total_paise, v_label);
  end if;

  return null;
end;
$fn$;

-- 0016's wording, with three more kinds.
create or replace function push_wording(
  p_kind    text,
  p_actor   text,
  p_subject text,
  p_amount  bigint
) returns jsonb
language plpgsql immutable as $fn$
declare
  v_money text := case
    when p_amount is null then ''
    else chr(8377) || trim(to_char(p_amount / 100.0, 'FM999999990.00'))
  end;
  v_who text := coalesce(p_actor, 'Someone');
begin
  return case p_kind
    when 'expense_added' then
      jsonb_build_object('title', v_who || ' added an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'expense_pending' then
      jsonb_build_object('title', v_who || ' added an expense to approve',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'expense_approved' then
      jsonb_build_object('title', v_who || ' approved an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'expense_rejected' then
      jsonb_build_object('title', v_who || ' rejected an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'expense_changed' then
      jsonb_build_object('title', v_who || ' changed an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' is now ' || v_money)
    when 'expense_deleted' then
      jsonb_build_object('title', v_who || ' deleted an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'settlement' then
      jsonb_build_object('title', 'Payment recorded',
                         'body',  coalesce(p_subject, '') || ' - ' || v_money)
    when 'member_added' then
      jsonb_build_object('title', 'New housemate',
                         'body',  v_who || ' added ' || coalesce(p_subject, 'someone'))
    when 'member_joined' then
      jsonb_build_object('title', coalesce(p_subject, 'Someone') || ' joined',
                         'body',  'They claimed their account')
    else
      jsonb_build_object('title', 'Roomly', 'body', 'Something changed in your household')
  end;
end;
$fn$;


-- ---------------------------  verification  ---------------------------
-- Every column must read true. If any is false, this migration did not apply.

select
  (select count(*) from information_schema.columns
    where table_name = 'expenses'
      and column_name in ('approval_status', 'reviewed_by', 'reviewed_at')) = 3  as columns_exist,
  (select count(*) = 0 from expenses where approval_status is null)                as every_row_has_a_status,
  (select count(*) from pg_trigger
    where tgname in ('expenses_approval_guard', 'splits_need_review')) = 2         as guards_installed,
  (select prosrc like '%waiting for approval%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'remove_member')                    as removal_checks_pending,
  (select prosrc like '%approval_status%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'member_balance')                   as balance_counts_approved_only,
  has_function_privilege('authenticated', 'review_expense(uuid, boolean, text)', 'execute') as review_open,
  has_function_privilege('authenticated', 'can_review_expense(expenses)', 'execute')        as can_review_open,
  not has_function_privilege('anon', 'review_expense(uuid, boolean, text)', 'execute')      as anon_cannot_review,
  (select count(*) = 0
     from member_balances b
     join member_ledger l on l.member_id = b.member_id
    where (l.owed_paise + l.settled_in_paise - l.paid_paise - l.settled_out_paise)
          <> -b.balance_paise)                                                     as breakdown_reconciles,
  (select count(*) = 0 from ledger_imbalance())                                    as ledger_still_balances;
