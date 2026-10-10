-- Roomly -- make create_expense idempotent, and scope it to your own household.
--
-- Two bugs, both in the single hottest write path.
--
-- 1. THE OUTBOX CAN DUPLICATE MONEY.
--
--    outbox.ts:58-60 and db/schema.ts:9-11 both state that client-generated
--    UUIDs make sync idempotent:
--
--      "ids are client-generated UUID strings, so a row has its permanent
--       identity before it ever reaches the server (makes sync idempotent)"
--
--    The id was never sent. create_expense had no id parameter and the drain
--    payload (sync.tsx:80-88) omitted it. So when the RPC committed but the
--    response was lost -- flaky signal, process death, timeout -- sync.tsx's
--    looksOffline() matched, recordFailure() kept the item queued, and
--    reconnecting posted the SAME EXPENSE A SECOND TIME.
--
--    The ledger canary cannot catch this: both copies are internally balanced,
--    so sum(balance_paise) stays zero while the household is charged twice.
--    Manual test 8.5 covers it and has never been run.
--
-- 2. NOTHING CHECKED THAT THE PEOPLE NAMED ARE IN YOUR HOUSEHOLD.
--
--    p_paid_by went straight into the insert, guarded only by the global FK to
--    members(id). The expenses_insert policy (0003_rls.sql:75-80) checks
--    household_id and created_by but not paid_by, and splits_write (:98-112)
--    constrains the EXPENSE's household while placing no constraint at all on
--    member_id. member_balances sums a member's splits with no household
--    filter, so a foreign member id lands in THEIR household's balances and
--    breaks THEIR zero-sum canary.
--
--    Low exploitability -- you need another household's member UUID, which the
--    app never exposes -- but it is the one place the schema's "every write is
--    scoped to your household" invariant does not actually hold.
--
-- BREAKING: the old 7-argument signature is dropped rather than overloaded.
-- Two candidates differing only by a defaulted trailing argument make
-- PostgREST refuse to choose. The APK must be rebuilt against this migration.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  the idempotency key  ---------------------
-- Nullable, so every row written before this migration stays valid. The
-- partial unique index ignores those nulls and constrains only rows that
-- carry a client id.

alter table expenses add column if not exists client_id uuid;

create unique index if not exists expenses_client_id_key
  on expenses (household_id, client_id)
  where client_id is not null;

comment on column expenses.client_id is
  'The queued outbox id from the device that created this expense. Unique per '
  'household, so replaying a request whose response was lost returns the '
  'original row instead of writing a second one. Null for anything created '
  'before migration 0022, and for any client that does not send one.';


-- ---------------------  the write path  ---------------------

drop function if exists create_expense(bigint, uuid, date, uuid, jsonb, text, uuid);

create or replace function create_expense(
  p_total_paise    bigint,
  p_category       uuid,
  p_expense_date   date,
  p_paid_by        uuid,
  p_splits         jsonb,
  p_description    text default null,
  p_payment_method uuid default null,
  p_client_id      uuid default null
) returns uuid
language plpgsql as $fn$
declare
  v_me      uuid := current_member();
  v_house   uuid := current_household();
  v_expense uuid;
  v_split   jsonb;
  v_sum     bigint;
begin
  if v_me is null then
    raise exception 'You are not a member of any household';
  end if;

  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'An expense needs at least one participant';
  end if;

  -- Already accepted from this device? Hand back the original. This is the
  -- fast path for a retry whose first attempt actually succeeded.
  if p_client_id is not null then
    select id into v_expense
      from expenses
     where household_id = v_house and client_id = p_client_id;
    if found then
      return v_expense;
    end if;
  end if;

  select sum((s->>'amount_paise')::bigint) into v_sum
    from jsonb_array_elements(p_splits) s;

  if v_sum <> p_total_paise then
    raise exception 'Splits sum to % paise but the total is % paise', v_sum, p_total_paise;
  end if;

  -- Household scoping. Residency by DATE is a separate concern, already
  -- enforced by check_split_residency (0002_invariants.sql:122-143); this only
  -- asserts that these people are ours at all.
  if not exists (
    select 1 from members where id = p_paid_by and household_id = v_house
  ) then
    raise exception 'The payer is not a member of this household';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_splits) s
     where not exists (
       select 1 from members m
        where m.id = (s->>'member_id')::uuid and m.household_id = v_house
     )
  ) then
    raise exception 'A split names someone who is not in this household';
  end if;

  -- Separate statement, so the RLS check that follows can see the period.
  perform ensure_period(v_house, p_expense_date);

  -- The read above is not atomic with this insert, so two drains racing the
  -- same queued item both reach here. The partial unique index is what
  -- actually decides it; the loser returns the winner's row.
  begin
    insert into expenses (
      household_id, paid_by, total_paise, description,
      category_id, payment_method_id, expense_date, created_by, client_id
    ) values (
      v_house, p_paid_by, p_total_paise, nullif(trim(coalesce(p_description, '')), ''),
      p_category, p_payment_method, p_expense_date, v_me, p_client_id
    )
    returning id into v_expense;
  exception when unique_violation then
    select id into v_expense
      from expenses
     where household_id = v_house and client_id = p_client_id;
    -- The winning transaction wrote the splits too, so there is nothing left
    -- to do and nothing half-written to clean up.
    return v_expense;
  end;

  for v_split in select * from jsonb_array_elements(p_splits) loop
    insert into expense_splits (expense_id, member_id, amount_paise)
    values (v_expense, (v_split->>'member_id')::uuid, (v_split->>'amount_paise')::bigint);
  end loop;

  return v_expense;
end;
$fn$;

grant execute on function
  create_expense(bigint, uuid, date, uuid, jsonb, text, uuid, uuid)
to authenticated;


-- ---------------------  defence in depth on the policy  ---------------------
-- create_expense is the only sanctioned way in, but the policy is what holds
-- if anything ever writes expense_splits directly.

drop policy if exists splits_write on expense_splits;
create policy splits_write on expense_splits for all
  using (exists (
    select 1 from expenses e
    where e.id = expense_id
      and e.household_id = current_household()
      and period_is_open(e.period_id)
      and (e.created_by = current_member() or is_owner())
  ))
  with check (
    exists (
      select 1 from expenses e
      where e.id = expense_id
        and e.household_id = current_household()
        and period_is_open(e.period_id)
        and (e.created_by = current_member() or is_owner())
    )
    and exists (
      select 1 from members m
      where m.id = member_id and m.household_id = current_household()
    )
  );


-- ---------------------------  verification  ---------------------------
-- All five must read true.

select
  (select count(*) from information_schema.columns
    where table_name = 'expenses' and column_name = 'client_id')           = 1 as client_id_column,
  (select count(*) from pg_indexes
    where tablename = 'expenses' and indexname = 'expenses_client_id_key') = 1 as unique_index,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_expense')           = 1 as exactly_one_create_expense,
  (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_expense')           = 8 as takes_client_id,
  (select count(*) = 0 from ledger_imbalance())                                as ledger_still_balances;
