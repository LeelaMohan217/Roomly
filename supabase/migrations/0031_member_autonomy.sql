-- Roomly -- let a flatmate fix their own typo, and add the thing they pay for.
--
-- Two rules that made sense for a landlord and are heavy for four friends.
--
-- 1. YOU COULD NOT FIX YOUR OWN TYPO.
--
--    expenses_owner_update (0003_rls.sql:83-88) is is_owner(), full stop. Ravi
--    types 300 for a 30-rupee milk run, spots it two seconds later, and has to
--    raise a pending_change and wait for the owner to be free. Among four
--    friends that is the rule most likely to end with "let us just use the
--    WhatsApp group".
--
--    The approval gate was never what provided accountability -- audit_log is.
--    Every edit is recorded with who made it, by triggers the client cannot
--    reach (0003_rls.sql revokes INSERT/UPDATE/DELETE on it from every client
--    role), and everyone sees an expense_changed notification. None of that
--    depends on the owner being in the loop.
--
--    So: you may edit or delete an expense YOU CREATED, for a short window
--    after creating it, while the month is open. Everything else -- anyone
--    else's expense, anything older than the window, anything in a closed
--    month -- still goes through pending_changes exactly as before.
--
--    created_by is the anchor because it is the one field nothing can change:
--    create_expense sets it to current_member() and update_expense never
--    touches it.
--
-- 2. ONLY THE OWNER COULD ADD A CATEGORY OR A RECURRING BILL.
--
--    A flatmate who starts buying the water can cannot add "Water can" -- they
--    message the owner. But the two are not equally risky and this migration
--    does not treat them as such:
--
--      a category      is additive. It changes nothing that already exists.
--                      Any member may create one. Only the owner may change or
--                      archive one ONCE IT IS IN USE -- kind and
--                      respects_away_calendar decide how expenses split, and
--                      changing them under a category people are already using
--                      changes the meaning of their entries. Before it has any
--                      expenses, its creator may still fix it.
--
--      a recurring bill posts money every month, on its own, attributed to
--                      whoever paid_by names. A member may create one ONLY
--                      WITH THEMSELVES AS THE PAYER -- "I pay for the water
--                      can" -- and may manage the rules they created. Nobody
--                      but the owner can commit somebody else to paying
--                      something every month.
--
-- The edit window is a household setting rather than a constant, because it is
-- exactly the sort of number four people will want to argue about, and that
-- argument should not need a migration.
--
-- No signature changes, so this needs no new APK -- but the app will not OFFER
-- the new powers until it is rebuilt, since the buttons are gated client-side
-- too.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  how long you get to fix a typo  ---------------------

alter table households add column if not exists self_edit_minutes smallint not null default 15
  check (self_edit_minutes between 0 and 1440);

comment on column households.self_edit_minutes is
  'How long after creating an expense you may still correct it yourself, in '
  'minutes. 0 restores the old owner-approves-everything behaviour; 1440 is a '
  'day. Long enough for a typo, short enough that a settled-looking figure '
  'does not quietly move. Change it with a plain UPDATE -- no migration.';


-- ---------------------  the one definition of "may I edit this"  ------------
-- Used by the RLS policy AND by the computed column below, so the screen and
-- the database can never disagree about whether the button should work. That
-- disagreement is the failure mode this whole schema keeps producing.

create or replace function can_self_edit(
  p_created_by uuid,
  p_created_at timestamptz,
  p_household  uuid,
  p_period     uuid
) returns boolean
language sql stable set search_path = public as $$
  select
    period_is_open(p_period)
    and (
      is_owner()
      or (
        p_created_by = current_member()
        and p_created_at > now() - make_interval(mins => coalesce(
              (select h.self_edit_minutes from households h where h.id = p_household), 0)::int)
      )
    );
$$;

grant execute on function can_self_edit(uuid, timestamptz, uuid, uuid) to authenticated;


-- A PostgREST computed column: a function taking the table's row type is
-- selectable as if it were a column, so the expense screen can ask the server
-- "may I edit this one?" instead of re-deriving the rule in TypeScript.
create or replace function can_edit_now(e expenses)
returns boolean
language sql stable set search_path = public as $$
  select can_self_edit(e.created_by, e.created_at, e.household_id, e.period_id);
$$;

grant execute on function can_edit_now(expenses) to authenticated;


-- ---------------------  the policy itself  ---------------------

drop policy if exists expenses_owner_update on expenses;
drop policy if exists expenses_update on expenses;

create policy expenses_update on expenses for update
  using (
    household_id = current_household()
    and can_self_edit(created_by, created_at, household_id, period_id)
  )
  with check (
    household_id = current_household()
    and can_self_edit(created_by, created_at, household_id, period_id)
  );

-- The splits policy already allowed `e.created_by = current_member()`
-- (0022:167-186), which was strictly more permissive than the expenses policy
-- it sat next to -- a member could write splits for a row they were not
-- allowed to update. Aligning it on the same function removes that oddity.
drop policy if exists splits_write on expense_splits;
create policy splits_write on expense_splits for all
  using (exists (
    select 1 from expenses e
    where e.id = expense_id
      and e.household_id = current_household()
      and can_self_edit(e.created_by, e.created_at, e.household_id, e.period_id)
  ))
  with check (
    exists (
      select 1 from expenses e
      where e.id = expense_id
        and e.household_id = current_household()
        and can_self_edit(e.created_by, e.created_at, e.household_id, e.period_id)
    )
    and exists (
      select 1 from members m
      where m.id = member_id and m.household_id = current_household()
    )
  );


-- ---------------------  categories a member can add  ---------------------

alter table categories add column if not exists created_by uuid references members(id);

comment on column categories.created_by is
  'Null for the thirteen seeded by create_household, and for anything an owner '
  'adds. Set when a member adds one, so they can still fix it while it has no '
  'expenses on it.';

drop policy if exists categories_owner_write on categories;

-- Additive: creating a category changes nothing that already exists.
create policy categories_member_insert on categories for insert
  with check (
    household_id = current_household()
    and (is_owner() or created_by = current_member())
  );

-- kind and respects_away_calendar decide how an expense splits, so changing
-- them under a category people are already using changes what their entries
-- mean. Before it has any expenses, its creator may still correct it.
create policy categories_update on categories for update
  using (
    household_id = current_household()
    and (
      is_owner()
      or (
        created_by = current_member()
        and not exists (select 1 from expenses e where e.category_id = categories.id)
      )
    )
  )
  with check (household_id = current_household());

create policy categories_owner_delete on categories for delete
  using (household_id = current_household() and is_owner());


-- ---------------------  bills a member can commit to  ---------------------

drop policy if exists recurring_owner_write on recurring_expenses;

-- "I pay for the water can." A member may create a rule only with THEMSELVES
-- as the payer -- committing somebody else to paying every month stays the
-- owner's call.
create policy recurring_member_insert on recurring_expenses for insert
  with check (
    household_id = current_household()
    and created_by = current_member()
    and (is_owner() or paid_by = current_member())
  );

create policy recurring_manage on recurring_expenses for update
  using (
    household_id = current_household()
    and (is_owner() or created_by = current_member())
  )
  with check (
    household_id = current_household()
    and (is_owner() or paid_by = current_member())
  );

create policy recurring_manage_delete on recurring_expenses for delete
  using (
    household_id = current_household()
    and (is_owner() or created_by = current_member())
  );


-- ---------------------------  verification  ---------------------------
-- The first six must read true. `edit_window_minutes` is informational -- the
-- default is 15; change it with:
--
--   update households set self_edit_minutes = 30;

select
  (select count(*) from information_schema.columns
    where table_name = 'households' and column_name = 'self_edit_minutes')     = 1 as window_column,
  (select count(*) from information_schema.columns
    where table_name = 'categories' and column_name = 'created_by')            = 1 as category_author,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('can_self_edit', 'can_edit_now')) = 2 as edit_fns,
  (select count(*) from pg_policies
    where tablename = 'expenses' and policyname = 'expenses_update'
      and qual like '%can_self_edit%')                                         = 1 as expense_policy,
  (select count(*) from pg_policies
    where tablename = 'recurring_expenses' and policyname = 'recurring_member_insert') = 1 as recurring_policy,
  (select count(*) = 0 from ledger_imbalance())                                    as ledger_still_balances,
  (select self_edit_minutes from households limit 1)                               as edit_window_minutes;
