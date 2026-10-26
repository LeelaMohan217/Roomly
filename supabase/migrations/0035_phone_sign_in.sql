-- Roomly -- sign in with a phone number and password, no SMS codes.
--
-- WHAT IT DOES.
--
-- An account can carry an Indian mobile number as a second way to sign in.
-- Supabase Auth itself only signs in by phone through SMS codes, which cost
-- money per message, so this does not use Supabase's phone sign-in at all.
-- Instead the number maps to the account's EMAIL, and the app signs in with
-- that email and the password the person typed.
--
--   phone_logins             one row per account that has a number.
--   link_phone_on_signup()   trigger on auth.users: the number given at
--                            sign-up (user metadata 'phone') becomes a row.
--                            A number already in use aborts the sign-up.
--   phone_is_available()     lets the sign-up form say "already registered"
--                            before submitting.
--   phone_sign_in_email()    checks the password HERE, against the stored
--                            hash, and only then returns the email.
--
-- WHY THE PASSWORD IS CHECKED IN SQL.
--
-- A plain "email for this phone" lookup would let anyone with the APK walk
-- through phone numbers and collect every member's email address. Checking
-- the password first means the email is only ever handed to someone who has
-- just proven they know that account's password -- the owner.
--
-- Five wrong passwords lock a number for fifteen minutes. Supabase Auth rate
-- limits its own sign-in endpoint per IP, but these calls reach the database
-- through PostgREST, so they need their own limit.
--
-- THE EXCEPTION TO 0034.
--
-- 0034 left nothing callable by anon. Signing in happens BEFORE anyone is
-- signed in, so phone_is_available and phone_sign_in_email are granted to
-- anon. They are the only two, and the check at the bottom asserts exactly
-- that.
--
-- KNOWN LIMIT. The number is not verified -- nobody receives a code. Someone
-- could register a number that is not theirs, and then its real owner cannot
-- use it. Email sign-in always still works. Verification by SMS can be added
-- later on top of this table without changing the app's sign-in screen.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


create extension if not exists pgcrypto with schema extensions;


-- 1. The numbers.
create table if not exists phone_logins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  phone      text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now()
);

alter table phone_logins enable row level security;

drop policy if exists phone_logins_read_own on phone_logins;
create policy phone_logins_read_own on phone_logins for select
  using (user_id = auth.uid());
-- No insert, update or delete policy: rows are written by the trigger below.


-- 2. Wrong-password counter, per number. No policies: clients never touch it.
create table if not exists phone_login_attempts (
  phone        text primary key,
  failures     smallint not null default 0,
  locked_until timestamptz
);

alter table phone_login_attempts enable row level security;


-- 3. The number given at sign-up becomes a row.
create or replace function link_phone_on_signup()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');
begin
  if v_phone is null then
    return new;
  end if;

  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'That phone number is not valid.';
  end if;

  -- A number already linked to another account raises a unique violation
  -- here, which aborts the whole sign-up. That is intended: an account must
  -- not be created believing it can sign in with a number it does not own.
  insert into phone_logins (user_id, phone) values (new.id, v_phone);
  return new;
end;
$fn$;

drop trigger if exists link_phone_on_signup on auth.users;
create trigger link_phone_on_signup
  after insert on auth.users
  for each row execute function link_phone_on_signup();


-- 4. Is a number free?
create or replace function phone_is_available(p_phone text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_phone ~ '^\+[1-9][0-9]{7,14}$'
     and not exists (select 1 from phone_logins where phone = p_phone);
$fn$;


-- 5. Phone and password in, email out -- only when the password is right.
create or replace function phone_sign_in_email(p_phone text, p_password text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $fn$
declare
  v_locked timestamptz;
  v_email  text;
  v_hash   text;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
     or coalesce(length(p_password), 0) = 0 then
    return null;
  end if;

  select locked_until into v_locked from phone_login_attempts where phone = p_phone;

  if v_locked is not null and v_locked > now() then
    raise exception 'Too many wrong attempts. Try again in 15 minutes.';
  end if;

  -- A lock that has run out starts the count again.
  if v_locked is not null then
    delete from phone_login_attempts where phone = p_phone;
  end if;

  select u.email, u.encrypted_password
    into v_email, v_hash
    from phone_logins p
    join auth.users u on u.id = p.user_id
   where p.phone = p_phone;

  if v_hash is not null and v_hash = crypt(p_password, v_hash) then
    delete from phone_login_attempts where phone = p_phone;
    return v_email;
  end if;

  -- Wrong password, or no such number: the same answer either way.
  insert into phone_login_attempts (phone, failures, locked_until)
  values (p_phone, 1, null)
  on conflict (phone) do update
    set failures     = phone_login_attempts.failures + 1,
        locked_until = case when phone_login_attempts.failures + 1 >= 5
                            then now() + interval '15 minutes' end;
  return null;
end;
$fn$;


-- 6. Grants. Closed by default (0034), then opened to exactly what sign-in
-- needs. The trigger function needs no grant.
revoke execute on function link_phone_on_signup()               from public, anon, authenticated;
revoke execute on function phone_is_available(text)             from public, anon, authenticated;
revoke execute on function phone_sign_in_email(text, text)      from public, anon, authenticated;
grant  execute on function phone_is_available(text)             to anon, authenticated;
grant  execute on function phone_sign_in_email(text, text)      to anon, authenticated;


-- Verify. Every column must read true.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('phone_logins', 'phone_login_attempts')) = 2  as tables_exist,
  (select count(*) from pg_trigger where tgname = 'link_phone_on_signup') = 1                         as signup_trigger_exists,
  has_function_privilege('anon', 'phone_sign_in_email(text,text)', 'execute')                          as anon_can_sign_in_by_phone,
  has_function_privilege('anon', 'phone_is_available(text)', 'execute')                                as anon_can_check_a_number,
  not has_function_privilege('anon', 'link_phone_on_signup()', 'execute')                              as anon_cannot_call_trigger,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                        and d.objid = p.oid and d.deptype = 'e')) = 2                                  as anon_can_call_only_these_two,
  phone_sign_in_email('not-a-phone', 'x') is null                                                     as malformed_number_returns_nothing;
