-- Roomly -- let someone who moved out come back, and stop relying on a
-- dashboard checkbox nobody wrote down.
--
-- BUG 1 -- A REMOVED MEMBER IS LOCKED OUT OF THE APP FOREVER.
--
--   members.user_id is GLOBALLY unique (0001_schema.sql:33) and remove_member
--   only sets left_on -- the row keeps its user_id. So for anyone who has ever
--   been moved out of a household:
--
--     * create_household passes its own `left_on is null` guard
--       (0011_apply_fixes.sql:178) and then hits the global unique index on the
--       insert at :182-183. Postgres raises 23505, errors.ts:24 renders it as
--       "That already exists.", and no household is created.
--
--     * request_join refuses with "You are already a member of this
--       household", because its check (0004_functions.sql:181-183) does not
--       filter left_on.
--
--   Neither message is true, and there is no third option: the user is stuck on
--   /onboarding with two buttons that both fail. Rejoining the flat you left in
--   June is a completely ordinary thing to want.
--
--   Fixed by making the constraint say what was actually meant: one ACTIVE
--   membership per auth user, not one ever. A partial unique index does that
--   and keeps the historical user_id on the departed row, so the audit trail
--   still records which account that member was. (Nulling user_id on the way
--   out would also have freed the index, at the cost of that link -- the
--   partial index is strictly better.)
--
-- BUG 2 -- THE WAITING SCREEN DEPENDS ON AN UNRECORDED MANUAL STEP.
--
--   session.tsx subscribes to join_requests over Realtime, and that is the ONLY
--   thing that advances the waiting screen. realtime.ts subscribes to
--   notifications for live household updates. postgres_changes requires the
--   table to be in the supabase_realtime publication -- and no migration in
--   this repo adds any table to it. It was a dashboard checkbox described in
--   supabase/README.md, which also names the WRONG tables: it lists expenses
--   and pending_changes, and never mentions notifications, which is what the
--   app actually listens to.
--
--   So on a fresh project, following the README exactly, an approved joiner
--   sits on "Waiting for approval" forever and nothing in the app ever
--   refreshes live. Putting it in a migration makes it reproducible.
--
--   The app also gains a polling fallback, because a publication is still
--   something that can be switched off in a dashboard.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- ---------------------  one ACTIVE membership per account  ---------------------

-- The column-level `unique` from 0001 is what blocks rejoining. Named
-- explicitly as well as generically because Postgres derives the name and a
-- restored-from-backup database could differ.
alter table members drop constraint if exists members_user_id_key;
alter table members drop constraint if exists members_user_id_unique;

create unique index if not exists members_active_user_key
  on members (user_id)
  where user_id is not null and left_on is null;

comment on index members_active_user_key is
  'One ACTIVE membership per auth user. Deliberately partial: a departed row '
  'keeps its user_id so history still records who that member was, while the '
  'account is free to start a household or rejoin. A plain unique constraint '
  'on the column locked anyone who had ever been removed out of the whole app.';


-- ---------------------  and the check that agreed with it  ---------------------

create or replace function request_join(p_code text, p_name text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_invite  invites;
  v_request uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Reuses preview_invite's validation by re-checking the same conditions.
  select * into v_invite from invites where code = upper(trim(p_code));
  if v_invite is null
     or v_invite.revoked_at is not null
     or v_invite.expires_at < now()
     or v_invite.used_count >= v_invite.max_uses then
    raise exception 'That invite code is not valid';
  end if;

  -- `left_on is null` is the fix. Without it, someone who moved out of this
  -- household in June was told they were already in it when they tried to
  -- come back in September.
  if exists (select 1 from members
              where user_id = auth.uid()
                and household_id = v_invite.household_id
                and left_on is null) then
    raise exception 'You are already a member of this household';
  end if;

  -- Nor may you hold a membership somewhere else. This was never checked at
  -- all: the old condition was scoped to the invite's household, so someone
  -- could sit in two households at once and current_household()'s `limit 1`
  -- would pick one of them arbitrarily.
  if exists (select 1 from members
              where user_id = auth.uid() and left_on is null) then
    raise exception 'You are already in a household. Leave it before joining another.';
  end if;

  -- One live request at a time, so the unique index on
  -- (household_id, user_id) where status = 'pending' is never the thing that
  -- reports this, with a message about an index.
  if exists (select 1 from join_requests
              where user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a request waiting. Cancel it before sending another.';
  end if;

  if p_claim is not null and exists (
    select 1 from members where id = p_claim and user_id is not null
  ) then
    raise exception 'That person has already claimed their account';
  end if;

  insert into join_requests (household_id, invite_code, user_id, display_name, email, claim_member_id)
  values (
    v_invite.household_id, v_invite.code, auth.uid(), p_name,
    (select email from auth.users where id = auth.uid()),
    p_claim
  )
  returning id into v_request;

  return v_request;
end;
$fn$;

grant execute on function request_join(text, text, uuid) to authenticated;


-- ---------------------  Realtime, in code rather than a checkbox  ------------
-- notifications is what realtime.ts listens to for live household updates;
-- join_requests is what session.tsx listens to so the waiting screen advances
-- by itself. Both are guarded because adding a table twice is an error.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'join_requests'
  ) then
    alter publication supabase_realtime add table join_requests;
  end if;
end
$$;


-- ---------------------------  verification  ---------------------------
-- All five must read true. The second is the substance of bug 1: a departed
-- member and an active one may now share an account, which is what makes
-- rejoining possible.

select
  (select count(*) from pg_constraint
    where conrelid = 'members'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id)')       = 0 as global_unique_gone,
  (select count(*) from pg_indexes
    where tablename = 'members' and indexname = 'members_active_user_key') = 1 as partial_index_present,
  (select prosrc like '%left_on is null%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_join')       as rejoin_allowed,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('notifications', 'join_requests'))      = 2 as realtime_enabled,
  (select count(*) = 0 from ledger_imbalance())                      as ledger_still_balances;
