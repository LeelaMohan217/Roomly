-- Roomly — end-to-end smoke test.
--
-- Exercises the whole design against a throwaway household:
--   create household → seed categories → add placeholders →
--   Kiran goes home → ₹100 milk splits 3 ways → ₹20,000 rent splits 4 ways →
--   balances must sum to exactly zero.
--
-- Run smoke.sql, read the results, then run cleanup.sql.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'smoke@test.local', '',
   now(), now(), now());

-- Make auth.uid() resolve to that user for the rest of this session.
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

do $$
declare
  v_house    uuid;
  v_me       uuid;
  v_ravi     uuid;
  v_arjun    uuid;
  v_kiran    uuid;
  v_milk     uuid;
  v_rent     uuid;
  v_exp      uuid;
  v_expected uuid[];
  v_actual   uuid[];
begin
  -- 1. first run: household + owner + 13 seeded categories
  v_house := create_household('Flat 302 Gachibowli', 'Mohan');
  select id into v_me from members
   where household_id = v_house and user_id = auth.uid();

  -- 2. the other three exist before they ever install the app
  v_ravi  := add_placeholder_member('Ravi');
  v_arjun := add_placeholder_member('Arjun');
  v_kiran := add_placeholder_member('Kiran');

  select id into v_milk from categories where household_id = v_house and name = 'Milk';
  select id into v_rent from categories where household_id = v_house and name = 'Rent';

  -- 3. Kiran goes to his hometown for ten days
  insert into away_periods (household_id, member_id, start_date, end_date)
  values (v_house, v_kiran, current_date - 2, current_date + 8);

  -- 4. the away calendar should drop Kiran from milk but not from rent
  v_expected := array[v_me, v_ravi, v_arjun];

  select array_agg(m.id order by m.joined_on, m.created_at) into v_actual
    from members m
   where m.household_id = v_house
     and m.left_on is null
     and not exists (
       select 1 from away_periods a
        where a.member_id = m.id
          and current_date >= a.start_date
          and (a.end_date is null or current_date <= a.end_date));

  if not (v_actual @> v_expected and v_expected @> v_actual) then
    raise exception 'AWAY CALENDAR FAILED: expected 3 present members, got %', array_length(v_actual, 1);
  end if;

  -- 5. ₹100 of milk, paid by Mohan, split among the three who were here.
  --    33.33 each leaves a paisa over; the payer absorbs it.
  insert into expenses (household_id, paid_by, total_paise, description,
                        category_id, expense_date, created_by)
  values (v_house, v_me, 10000, 'Milk', v_milk, current_date, v_me)
  returning id into v_exp;

  insert into expense_splits (expense_id, member_id, amount_paise) values
    (v_exp, v_me, 3334), (v_exp, v_ravi, 3333), (v_exp, v_arjun, 3333);

  -- 6. ₹20,000 rent, paid by Ravi, split four ways INCLUDING Kiran —
  --    his room didn't disappear while he was away.
  insert into expenses (household_id, paid_by, total_paise, description,
                        category_id, expense_date, created_by)
  values (v_house, v_ravi, 2000000, 'August rent', v_rent, current_date, v_me)
  returning id into v_exp;

  insert into expense_splits (expense_id, member_id, amount_paise) values
    (v_exp, v_me, 500000), (v_exp, v_ravi, 500000),
    (v_exp, v_arjun, 500000), (v_exp, v_kiran, 500000);

  -- 7. Ravi settles up with Mohan
  insert into settlements (household_id, period_id, from_member, to_member,
                           amount_paise, created_by)
  values (v_house,
          (select period_id from expenses where household_id = v_house limit 1),
          v_ravi, v_me, 3333, v_me);

  raise notice 'Smoke test wrote household %', v_house;
end;
$$;

-- ── results ──────────────────────────────────────────────────────────

select
  b.display_name,
  b.balance_paise,
  to_char(b.balance_paise / 100.0, 'FM999G999D00') as rupees
from member_balances b
join members m on m.id = b.member_id
join households h on h.id = m.household_id
where h.name = 'Flat 302 Gachibowli'
order by b.balance_paise desc;
