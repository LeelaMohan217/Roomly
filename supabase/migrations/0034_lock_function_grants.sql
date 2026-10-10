-- Roomly -- every function starts closed, and only the ones the app calls open.
--
-- THE HOLE.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase's
-- default privileges grant it again to anon and authenticated explicitly. The
-- only revoke in this schema is 0004:342 (`... from anon`), which applied to the
-- functions that existed at that moment and to nothing created since. So every
-- function from 0005 onward is callable over PostgREST by anyone holding the
-- publishable key -- which is everyone with the APK.
--
-- Most of them guard themselves (current_member() is null for a stranger, so
-- they exit early). Three do not:
--
--   * notify_household(p_household, ...) (0016:162) -- no check on the caller.
--     Anyone who knows a household id can write a notification into it with
--     any subject text, and it is pushed to every phone in that household.
--   * send_push_for_notification(p_notification) (0016:108) -- re-sends the
--     push for any notification id, as often as the caller likes.
--   * ensure_period(p_household, p_date) (0011:24) -- creates period rows in
--     any household. It is SECURITY DEFINER, so RLS on periods does not apply.
--
-- THE FIX, in three parts.
--
--   1. Revoke EXECUTE on every function in public from public, anon and
--      authenticated, then grant back to authenticated exactly the list below.
--      The state afterwards is the list, not whatever accumulated before.
--      Functions owned by an extension (btree_gist may live in public) are
--      left alone.
--
--   2. Default privileges: functions created by later migrations start with no
--      EXECUTE for anyone but the owner. Every migration in this repo already
--      ends with an explicit `grant execute ... to authenticated`, so this only
--      changes what happens when one is forgotten: the RPC fails loudly with
--      "permission denied" instead of being silently open to the internet.
--
--   3. ensure_period refuses a household that is not the caller's. It cannot
--      simply be revoked: create_expense, update_expense and record_settlement
--      are SECURITY INVOKER and call it directly, so the caller needs EXECUTE.
--      Every legitimate caller passes current_household() or a row already
--      checked against it (post_recurring_now, 0030:128). auth.uid() is null
--      only for the database owner -- SQL Editor, seed scripts, a future
--      pg_cron job -- which keeps those working.
--
-- WHAT MUST STAY GRANTED TO authenticated, and why:
--
--   called by the app via .rpc()      (src/, 22 functions)
--   used inside RLS policies          current_household, current_member,
--                                     is_owner, can_self_edit, period_is_open
--   used inside a view                member_balance (member_balances)
--   computed column read by the app   can_edit_now
--   called by INVOKER functions       ensure_period, household_today
--   RPCs kept for upcoming work       unregister_push_token (sign-out, H6),
--                                     set_member_joined_on
--
-- Trigger functions need no grant: Postgres checks EXECUTE when a trigger is
-- created, not when it fires. SECURITY DEFINER functions call their helpers
-- (notify_household, push_wording, gen_invite_code, ...) as the owner, so
-- revoking those from clients does not affect them.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


-- 1. ensure_period: only the caller's own household.
create or replace function ensure_period(p_household uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_period uuid;
begin
  if auth.uid() is not null and p_household is distinct from current_household() then
    raise exception 'Not your household' using errcode = '42501';
  end if;

  insert into periods (household_id, year, month)
  values (
    p_household,
    extract(year  from p_date)::smallint,
    extract(month from p_date)::smallint
  )
  on conflict (household_id, year, month)
    do update set household_id = excluded.household_id
  returning id into v_period;

  return v_period;
end;
$fn$;


-- 2. Close everything we own in public.
do $do$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end;
$do$;


-- 3. Open the allowlist to signed-in users. By name, so every overload is
-- covered and a signature change in a later migration cannot miss one.
do $do$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         -- called by the app
         'add_placeholder_member', 'close_period', 'create_expense',
         'create_household', 'create_invite', 'mark_notifications_read',
         'post_due_recurrences', 'post_recurring_now', 'preview_invite',
         'record_settlement', 'register_push_token', 'remove_member',
         'reopen_period', 'request_join', 'review_join_request',
         'review_pending_change', 'review_settlement', 'transfer_ownership',
         'unvoid_expense', 'update_expense', 'update_my_profile', 'void_expense',
         -- RLS policies, views, computed columns
         'current_household', 'current_member', 'is_owner', 'can_self_edit',
         'period_is_open', 'member_balance', 'can_edit_now',
         -- called by SECURITY INVOKER functions
         'ensure_period', 'household_today',
         -- kept for upcoming work
         'unregister_push_token', 'set_member_joined_on'
       )
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;


-- 4. Future functions start closed.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;


-- Verify. Every column must read true.
select
  not has_function_privilege('anon',          'notify_household(uuid,text,uuid,bigint,text)', 'execute') as anon_cannot_notify,
  not has_function_privilege('authenticated', 'notify_household(uuid,text,uuid,bigint,text)', 'execute') as user_cannot_notify,
  not has_function_privilege('authenticated', 'send_push_for_notification(uuid)', 'execute')             as user_cannot_resend_push,
  not has_function_privilege('anon',          'ensure_period(uuid,date)', 'execute')                     as anon_cannot_make_periods,
  (select prosrc like '%Not your household%' from pg_proc where proname = 'ensure_period'
     and pronamespace = 'public'::regnamespace)                                                          as ensure_period_checks_household,
  not has_function_privilege('authenticated', 'ledger_imbalance()', 'execute')                           as canary_still_locked,
  has_function_privilege('authenticated', 'current_household()', 'execute')                              as policies_still_work,
  has_function_privilege('authenticated', 'member_balance(uuid)', 'execute')                             as balances_view_works,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_expense', 'record_settlement', 'update_expense', 'create_household')
      and has_function_privilege('authenticated', p.oid, 'execute')) >= 4                                as app_rpcs_still_open,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                        and d.objid = p.oid and d.deptype = 'e')) = 0                                    as anon_can_call_nothing,
  (select count(*) = 0 from ledger_imbalance())                                                          as ledger_still_balances;
