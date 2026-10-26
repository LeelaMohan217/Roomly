-- Roomly -- an existing account adds or changes its own phone number.
--
-- 0035 linked a number to an account only at sign-up, through a trigger on
-- auth.users. Every account made before that has no row in phone_logins and
-- no way to get one, so none of them could sign in by phone. This gives a
-- signed-in person exactly one thing: set the number on THEIR OWN account.
--
--   set_my_phone(p_phone)   validates the number, refuses one that belongs
--                           to another account, and inserts or replaces the
--                           caller's row. Signed-in only.
--
-- Reading your own number needs nothing new: 0035's policy already lets an
-- account select its own phone_logins row.
--
-- The rules match 0035 and the app: E.164 shape (+91XXXXXXXXXX), one number
-- per account, one account per number.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


create or replace function set_my_phone(p_phone text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to add a phone number.';
  end if;

  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter a 10-digit mobile number.';
  end if;

  -- Checked first so the person reads a sentence, not a unique violation.
  if exists (select 1 from phone_logins where phone = p_phone and user_id <> v_user) then
    raise exception 'This number is already registered to another account.';
  end if;

  insert into phone_logins (user_id, phone)
  values (v_user, p_phone)
  on conflict (user_id) do update set phone = excluded.phone, created_at = now();

  -- A new number starts with a clean wrong-password count.
  delete from phone_login_attempts where phone = p_phone;
end;
$fn$;


-- Closed by default (0034); open to signed-in accounts only.
revoke execute on function set_my_phone(text) from public, anon, authenticated;
grant  execute on function set_my_phone(text) to authenticated;


-- Verify. Every column must read true.
select
  (select count(*) from pg_proc where proname = 'set_my_phone'
     and pronamespace = 'public'::regnamespace) = 1                                                    as function_exists,
  has_function_privilege('authenticated', 'set_my_phone(text)', 'execute')                             as signed_in_can_set_phone,
  not has_function_privilege('anon', 'set_my_phone(text)', 'execute')                                  as signed_out_cannot,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                        and d.objid = p.oid and d.deptype = 'e')) = 2                                  as anon_still_only_two;
