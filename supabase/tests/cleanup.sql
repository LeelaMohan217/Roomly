-- Removes everything smoke.sql created.
--
-- Deletion has to be ordered by hand rather than left to ON DELETE CASCADE:
-- expense_splits.member_id has no cascade on purpose, because a member with
-- financial history must never be deletable. In real use you set left_on
-- instead of deleting anyone — this script exists only for test teardown.

do $$
declare
  v_house uuid;
begin
  select id into v_house from households where name = 'Flat 302 Gachibowli';
  if v_house is null then
    raise notice 'Nothing to clean up';
    return;
  end if;

  delete from expense_splits
   where expense_id in (select id from expenses where household_id = v_house);
  delete from settlements       where household_id = v_house;
  delete from expenses          where household_id = v_house;
  delete from away_periods      where household_id = v_house;
  delete from pending_changes   where household_id = v_house;
  delete from join_requests     where household_id = v_house;
  delete from invites           where household_id = v_house;
  delete from expense_templates where household_id = v_house;
  delete from periods           where household_id = v_house;
  delete from categories        where household_id = v_house;
  delete from payment_methods   where household_id = v_house;
  delete from audit_log         where household_id = v_house;

  -- households before members, so the owner trigger sees the household gone
  delete from households where id = v_house;
  delete from members    where household_id = v_house;
end;
$$;

delete from auth.users where email = 'smoke@test.local';

select 'cleaned' as status,
       (select count(*) from households)     as households_left,
       (select count(*) from members)        as members_left,
       (select count(*) from expenses)       as expenses_left,
       (select count(*) from expense_splits) as splits_left;
