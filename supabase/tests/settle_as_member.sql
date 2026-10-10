-- Roomly -- run record_settlement AS a member, and roll it back.
--
-- WHY THIS EXISTS
--
-- The SQL editor has no auth.uid(), so current_member() is null there and every
-- RPC in this schema stops at its first guard with "You are not a member of any
-- household". That makes the editor useless for the one question that matters
-- when a write is being refused: what does Postgres ACTUALLY say?
--
-- The app cannot answer it either. errors.ts translates the database's own
-- messages on purpose -- a flatmate should never read "new row violates
-- row-level security policy for table settlements" -- so by the time a human
-- sees it, the SQLSTATE and the message are gone. Good for them, useless for
-- whoever has to fix it.
--
-- This impersonates a member the way PostgREST does -- set the JWT claims, then
-- become `authenticated` -- calls the function for real, prints the raw error,
-- and rolls back. Nothing is written whichever way it goes.
--
-- Pure ASCII. Roll back at the end -- the ROLLBACK is not optional.


-- ------------------  1. who and what  ------------------
-- Edit these three names, then run the whole file as one script. They are
-- matched exactly as they appear on the Settle screen.
--
-- `who` is the person tapping the button. `payer` -> `payee` is the transfer.
-- Plain set_config rather than psql's \set, because the Supabase SQL editor is
-- not psql and treats a backslash command as a syntax error.

begin;

select set_config('roomly.who',   'Lee',    true);
select set_config('roomly.payer', 'Madhav', true);
select set_config('roomly.payee', 'Mani',   true);


-- ------------------  2. what the app would send  ------------------
-- Read as the owner, before dropping privileges, so this half cannot itself be
-- the thing that fails.

select
  m.display_name,
  m.role,
  m.user_id is not null as has_account,
  member_balance(m.id)  as balance_paise,
  case when member_balance(m.id) < 0 then 'owes -- can be a payer'
       else 'is owed -- record_settlement will refuse them as payer' end as direction
from members m
where m.household_id = (select household_id from members
                         where display_name = current_setting('roomly.who'))
  and m.left_on is null
order by member_balance(m.id);

select
  p.year, p.month, p.status,
  period_is_open(p.id) as reads_open
from periods p
order by p.year desc, p.month desc
limit 3;


-- ------------------  3. become that member  ------------------
-- Exactly what PostgREST does per request: the JWT claims go in a GUC, then the
-- role is dropped to `authenticated`. auth.uid() reads the claim, so
-- current_member() and is_owner() now answer as this person.

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  (select user_id from members where display_name = current_setting('roomly.who')),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

-- Sanity: these must name the person in `who`. If current_member is null, that
-- account has never signed in and there is nothing to impersonate.
select
  current_member()                                                   as me,
  (select display_name from members where id = current_member())     as me_name,
  is_owner()                                                         as am_owner,
  current_household()                                                as house;


-- ------------------  4. the actual call  ------------------
-- No error handler: the point is to see the SQLSTATE and the message exactly as
-- PostgREST would have returned them to the app.

select record_settlement(
  (select id from members where display_name = current_setting('roomly.payer')),
  (select id from members where display_name = current_setting('roomly.payee')),
  100,                       -- one rupee, deliberately: the amount is not what
                             -- is being tested, and this is rolled back anyway
  current_date,
  'diagnostic -- rolled back'
) as new_settlement_id;


-- ------------------  5. put everything back  ------------------

reset role;
rollback;


-- ------------------  reading the result  ------------------
--
-- A uuid in step 4          the write works. Whatever the app is hitting is in
--                           front of the database -- a stale bundle, or an
--                           amount/date the screen is sending that this file is
--                           not.
--
-- P0001 + an English sentence
--                           one of record_settlement's own guards. The sentence
--                           says which; the app shows it verbatim.
--
-- 42501                     a privilege or a policy. Should be impossible since
--                           0032 made the function SECURITY DEFINER -- if it
--                           happens, 0032 did not apply.
--
-- 23502 null value in ...   the settlements_set_period trigger is missing, so
--                           period_id came out null.
--
-- 23503 / 23514             a foreign key or check constraint -- read which one
--                           from the message.
--
-- anything else             paste the whole thing. The SQLSTATE is the useful
--                           half.
