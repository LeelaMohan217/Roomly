-- Roomly -- a private ledger: your own spending, seen by nobody else.
--
-- Rent, groceries and the gas cylinder live in `expenses`, which the whole
-- household reads and which moves balances. A gym membership or a Swiggy
-- order is nobody else's business and moves nobody's balance. This is a
-- separate table on purpose, NOT a "private" flag on `expenses`: balances,
-- approvals, notifications, Reports, statements, backups and realtime all
-- read `expenses`, and a flag would have to be honoured by every one of them,
-- for ever. A table nobody else can read cannot leak through a query that
-- forgot to filter.
--
--   personal_expenses   one row per private expense. Belongs to the ACCOUNT
--                       (auth user), not to a member row: it stays with the
--                       person if they leave a household or join another,
--                       and goes when their account is deleted.
--
-- Every operation is limited to rows whose user_id is the caller. Nobody else
-- -- not the household owner, not a housemate -- can read, add, change or
-- delete one. There are no functions: plain table access under RLS is all it
-- needs.
--
-- Categories are a fixed list of slugs the app knows (lib/personal.ts), not
-- the household's `categories`, which belong to a household and its owner.
--
-- client_id makes an add safe to retry: the same tap sent twice over a flaky
-- connection is one row, not two.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


create table if not exists personal_expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 10000000000),
  description  text not null check (char_length(btrim(description)) between 1 and 120),
  category     text not null default 'misc' check (category ~ '^[a-z_]{1,32}$'),
  spent_on     date not null default current_date,
  note         text check (note is null or char_length(note) <= 500),
  client_id    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, client_id)
);

-- The ledger screen reads one person's month, newest first.
create index if not exists personal_expenses_user_month
  on personal_expenses (user_id, spent_on desc, created_at desc);

alter table personal_expenses enable row level security;

drop policy if exists personal_expenses_own_read   on personal_expenses;
drop policy if exists personal_expenses_own_insert on personal_expenses;
drop policy if exists personal_expenses_own_update on personal_expenses;
drop policy if exists personal_expenses_own_delete on personal_expenses;

create policy personal_expenses_own_read on personal_expenses
  for select to authenticated using (user_id = auth.uid());

create policy personal_expenses_own_insert on personal_expenses
  for insert to authenticated with check (user_id = auth.uid());

create policy personal_expenses_own_update on personal_expenses
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy personal_expenses_own_delete on personal_expenses
  for delete to authenticated using (user_id = auth.uid());

-- Signed-in only. Supabase grants new tables to anon by default; RLS would
-- already return nothing, but a stranger has no reason to reach it at all.
revoke all on personal_expenses from anon, public;
grant select, insert, update, delete on personal_expenses to authenticated;


-- Verify. Every column must read true.
select
  (select relrowsecurity from pg_class where oid = 'public.personal_expenses'::regclass)          as rls_on,
  (select count(*) from pg_policies where tablename = 'personal_expenses') = 4                     as four_policies,
  not has_table_privilege('anon', 'public.personal_expenses', 'select')                             as anon_cannot_read,
  has_table_privilege('authenticated', 'public.personal_expenses', 'insert')                        as signed_in_can_add,
  (select count(*) from pg_policies where tablename = 'personal_expenses'
     and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')) = 4                          as every_policy_is_own_rows;
