-- Roomly -- an expense that is only yours does not wait for anybody.
--
-- THE BUG. Somebody adds their own rent: they paid it, and the split names
-- only them. 0039 made it 'pending' like any other expense, so it sat on
-- "Waiting for approval" -- and they could never approve it themselves, and
-- nothing told them anyone else had to. It was also announced to the whole
-- house as "added an expense to approve", for an expense that moves nobody's
-- balance but their own, by exactly zero.
--
-- THE RULE, added to 0039's list:
--
--   * An expense whose payer is the person who added it, and whose split
--     names only that same person, is approved on arrival. They paid X and
--     owe X: no balance moves, so there is nothing for a housemate to agree
--     to. It still counts in that month's totals and Reports, as before.
--   * The same holds after an edit: if the person who added it edits it and
--     it is still (or has become) only theirs, it does not go back to waiting.
--   * Anything that touches somebody else -- another payer, or anyone else in
--     the split -- is unchanged and waits for a housemate.
--
-- WHY AT COMMIT. The guard (0039) decides a new row's status on INSERT, before
-- create_expense has written a single split, so it cannot tell. And while
-- create_expense is writing splits one by one, a shared expense whose first
-- split is the author's would briefly look like it is only theirs. So the
-- check runs as a DEFERRED constraint trigger: at commit, when every split is
-- in place, it reads the finished expense and approves it only then.
--
-- It is SECURITY DEFINER so the guard sees server code and lets the status
-- change, exactly as recurring posts and review_expense do. It decides from
-- the rows actually stored, never from anything a client says, so nobody can
-- use it to approve an expense that involves anyone else.
--
-- NOTIFICATIONS. The "added an expense to approve" message used to go out the
-- moment the row was inserted -- before anyone could know it would be
-- approved a few statements later. That message, and the "waiting again"
-- message after an edit, now also go out at commit, after the check above, and
-- say what is true by then: still waiting -> "to approve"; approved -> "added
-- an expense", as for any expense that counts. An automatic approval itself
-- (reviewed_by null) announces nothing -- nobody approved anything.
--
-- ALSO HERE: every expense already stuck waiting that is only its author's is
-- approved now.
--
-- App: no change needed. It reads approval_status; this only changes what the
-- server stores.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ------------------------  what "only yours" means  ------------------------

create or replace function expense_is_only_its_authors(p_expense uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from expenses e
     where e.id = p_expense
       and e.paid_by = e.created_by
       and exists (select 1 from expense_splits s where s.expense_id = e.id)
       and not exists (select 1 from expense_splits s
                        where s.expense_id = e.id
                          and s.member_id <> e.created_by)
  );
$$;

comment on function expense_is_only_its_authors(uuid) is
  'True when the person who added an expense also paid it and is the only '
  'person in its split -- it moves no balance, so it needs no approval (0042).';

-- Called only from the trigger functions below, which run as the owner.
revoke execute on function expense_is_only_its_authors(uuid) from public, anon, authenticated;


-- ------------------------  approve it at commit  ------------------------

create or replace function expense_approve_if_only_authors()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- Read the row as it is NOW, at commit -- not NEW, which is the row as it
  -- was when this event was queued.
  update expenses e
     set approval_status = 'approved',
         reviewed_by     = null,
         reviewed_at     = now()
   where e.id = new.id
     and e.approval_status = 'pending'
     and e.voided_at is null
     and expense_is_only_its_authors(e.id);

  return null;
end;
$fn$;

revoke execute on function expense_approve_if_only_authors() from public, anon, authenticated;

-- Named to sort BEFORE expenses_notify_waiting: deferred triggers on the same
-- event fire in name order, and the message must see the decision.
drop trigger if exists expenses_approve_only_authors on expenses;
create constraint trigger expenses_approve_only_authors
  after insert or update on expenses
  deferrable initially deferred
  for each row
  when (new.approval_status = 'pending' and new.voided_at is null)
  execute function expense_approve_if_only_authors();


-- ------------------------  announce it at commit  ------------------------

create or replace function notify_expense_waiting()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_row   expenses%rowtype;
  v_label text;
begin
  select * into v_row from expenses where id = new.id;
  if not found or v_row.voided_at is not null then
    return null;
  end if;

  select coalesce(nullif(trim(coalesce(v_row.description, '')), ''), c.name)
    into v_label
    from categories c where c.id = v_row.category_id;

  if v_row.approval_status = 'pending' then
    perform notify_household(v_row.household_id, 'expense_pending', v_row.id, v_row.total_paise, v_label);
  elsif v_row.approval_status = 'approved' and tg_op = 'INSERT' then
    -- Approved on arrival because it is only theirs: an ordinary new expense.
    perform notify_household(v_row.household_id, 'expense_added', v_row.id, v_row.total_paise, v_label);
  end if;
  -- An edit that went back to waiting and was approved again at commit: it
  -- was only theirs, nobody else's balance moved, so nothing to say.

  return null;
end;
$fn$;

revoke execute on function notify_expense_waiting() from public, anon, authenticated;

-- Both named to sort AFTER expenses_approve_only_authors. An UPDATE that is already pending on both sides (a description fix on a
-- waiting expense) must not re-announce it. A WHEN clause on an insert-or-
-- update trigger cannot mention OLD, so the update side gets its own trigger.
drop trigger if exists expenses_notify_waiting on expenses;
create constraint trigger expenses_notify_waiting
  after insert on expenses
  deferrable initially deferred
  for each row
  when (new.approval_status = 'pending' and new.voided_at is null)
  execute function notify_expense_waiting();

drop trigger if exists expenses_notify_waiting_again on expenses;
create constraint trigger expenses_notify_waiting_again
  after update on expenses
  deferrable initially deferred
  for each row
  when (old.approval_status is distinct from 'pending'
        and new.approval_status = 'pending'
        and new.voided_at is null)
  execute function notify_expense_waiting();


-- ------------------------  the immediate notifier  ------------------------
-- 0039's notify_expense, with the two "waiting" announcements handed to the
-- commit-time trigger above, and automatic approvals kept quiet.

create or replace function notify_expense()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_label text;
begin
  select coalesce(nullif(trim(coalesce(new.description, '')), ''), c.name)
    into v_label
    from categories c where c.id = new.category_id;

  if tg_op = 'INSERT' then
    -- A pending one is announced at commit by expenses_notify_waiting.
    if new.approval_status <> 'pending' then
      perform notify_household(new.household_id, 'expense_added', new.id, new.total_paise, v_label);
    end if;
  elsif old.approval_status <> 'rejected' and new.approval_status = 'rejected' then
    perform notify_household(new.household_id, 'expense_rejected', new.id, new.total_paise, v_label);
  elsif old.voided_at is null and new.voided_at is not null then
    perform notify_household(new.household_id, 'expense_deleted', new.id, new.total_paise, v_label);
  elsif old.approval_status = 'pending' and new.approval_status = 'approved' then
    -- reviewed_by is null only for an automatic approval (0042): nobody to
    -- credit, and nothing anyone else needs to know.
    if new.reviewed_by is not null then
      perform notify_household(new.household_id, 'expense_approved', new.id, new.total_paise, v_label);
    end if;
  elsif old.approval_status <> 'pending' and new.approval_status = 'pending' then
    -- Announced at commit by expenses_notify_waiting_again.
    null;
  elsif old.total_paise <> new.total_paise or old.category_id <> new.category_id then
    perform notify_household(new.household_id, 'expense_changed', new.id, new.total_paise, v_label);
  end if;

  return null;
end;
$fn$;


-- ------------------------  the ones already stuck  ------------------------
-- Run as the owner, so the guard allows it; notify_expense stays quiet because
-- reviewed_by is null.

update expenses e
   set approval_status = 'approved',
       reviewed_by     = null,
       reviewed_at     = now()
 where e.approval_status = 'pending'
   and e.voided_at is null
   and expense_is_only_its_authors(e.id);


-- ---------------------------  verification  ---------------------------
-- Every column must read true. If any is false, this migration did not apply.

select
  (select count(*) from pg_trigger
    where tgname in ('expenses_approve_only_authors',
                     'expenses_notify_waiting',
                     'expenses_notify_waiting_again')
      and tgdeferrable and tginitdeferred) = 3                                    as commit_time_triggers,
  (select count(*) = 0 from expenses e
    where e.approval_status = 'pending' and e.voided_at is null
      and expense_is_only_its_authors(e.id))                                       as nothing_only_yours_is_waiting,
  not has_function_privilege('authenticated', 'expense_is_only_its_authors(uuid)', 'execute') as helper_closed,
  (select count(*) = 0 from ledger_imbalance())                                    as ledger_still_balances;
