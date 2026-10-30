-- Roomly -- make "every function starts closed" actually true.
--
-- THE BUG, found by 0039's own verification (anon_cannot_review read false).
--
-- 0034 meant new functions to start with no EXECUTE for anyone but the owner,
-- and said so:
--
--   alter default privileges for role postgres in schema public
--     revoke execute on functions from public, anon, authenticated;
--
-- That removes Supabase's per-schema grants to anon and authenticated. It
-- cannot remove PUBLIC's, because PUBLIC's EXECUTE on functions is a GLOBAL
-- default, and the Postgres manual is explicit that a per-schema default
-- privilege can only add to the global one: "you cannot revoke privileges
-- per-schema if they are granted globally". anon is a member of PUBLIC, so
-- every function CREATED after 0034 has been callable without signing in.
-- 0034's own check passed because, when it ran, there were none yet.
--
-- WHICH, AND HOW BAD. Only functions created new since 0034; a create-or-
-- replace keeps the grants the function already had, so update_expense,
-- member_balance, close_period, remove_member and the rest stay as 0034 left
-- them. 0035 and 0036 revoked theirs by hand. That leaves:
--
--   set_my_photo (0037), review_expense, can_review_expense,
--   expense_needs_a_reviewer (0039)     -- RPCs the app calls signed in
--   expense_approval_guard, expense_splits_need_review (0039),
--   check_attachment_limit (0040)       -- trigger functions
--
-- None of them does anything for a caller who is not signed in:
-- current_member() and current_household() are null, so review_expense finds
-- no expense and raises, set_my_photo raises, and the rest answer false or
-- nothing under RLS. So nothing was exposed -- but the rule is that a function
-- must not rely on that, and this restores it.
--
-- THE FIX. Revoke those from PUBLIC and anon (the signed-in grants the
-- migrations gave stay), and change the default GLOBALLY for functions the
-- postgres role creates from now on. That reaches other schemas too; Supabase's
-- own schemas are created by supabase_admin, not postgres, so they are not
-- affected. A future migration that forgets its `grant execute ... to
-- authenticated` now fails loudly with "permission denied", as 0034 intended.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


-- 1. The functions created open since 0034.
revoke execute on function set_my_photo(text)                       from public, anon;
revoke execute on function review_expense(uuid, boolean, text)      from public, anon;
revoke execute on function can_review_expense(expenses)             from public, anon;
revoke execute on function expense_needs_a_reviewer(uuid, uuid)     from public, anon;

-- Trigger functions need no grant at all: Postgres checks EXECUTE when a
-- trigger is created, not when it fires (0034's header).
revoke execute on function expense_approval_guard()      from public, anon, authenticated;
revoke execute on function expense_splits_need_review()  from public, anon, authenticated;
revoke execute on function check_attachment_limit()      from public, anon, authenticated;


-- 2. Future functions start closed -- globally, which is the level PUBLIC's
--    grant lives at.
alter default privileges for role postgres
  revoke execute on functions from public;


-- 3. Prove it on a function created after this line, then remove it. In a DO
--    block that fails loudly, because the SQL Editor shows only the last
--    statement's result and that has to be the SELECT below.
do $do$
begin
  create function _roomly_default_privilege_probe() returns int
    language sql as $$ select 1; $$;

  if has_function_privilege('anon', '_roomly_default_privilege_probe()', 'execute') then
    raise exception 'A new function is still callable without signing in. The default privilege did not change.';
  end if;

  drop function _roomly_default_privilege_probe();
end;
$do$;


-- ---------------------------  verification  ---------------------------
-- Every column must read true. (That new functions start closed was checked
-- by step 3, which stops the script with an error if they do not.)

select
  not has_function_privilege('anon', 'review_expense(uuid, boolean, text)', 'execute')      as anon_cannot_review,
  not has_function_privilege('anon', 'set_my_photo(text)', 'execute')                       as anon_cannot_set_photo,
  has_function_privilege('authenticated', 'review_expense(uuid, boolean, text)', 'execute') as members_can_review,
  has_function_privilege('authenticated', 'can_review_expense(expenses)', 'execute')        as review_column_works,
  has_function_privilege('authenticated', 'expense_needs_a_reviewer(uuid, uuid)', 'execute') as guard_can_ask,
  has_function_privilege('authenticated', 'set_my_photo(text)', 'execute')                  as photos_still_work,
  -- 0034's sweep, repeated: nothing outside an extension is open to anon.
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                        and d.objid = p.oid and d.deptype = 'e'))         = 0  as anon_can_call_nothing,
  (select count(*) = 0 from ledger_imbalance())                                as ledger_still_balances;
