-- The seeded category icons arrived as mojibake -- a house emoji came out
-- as two Latin-1 characters before the category name -- because the
-- migration was copied to the clipboard by a tool that read a UTF-8 file as
-- Windows ANSI. The emoji were corrupted in transit, before Postgres ever
-- saw them.
--
-- Rather than re-transmit emoji through the same fragile path, `icon` now
-- holds a plain ASCII slug and the app maps it to a glyph. SQL files stay
-- 7-bit, so this class of bug cannot recur.

begin;

update categories set icon = 'rent'        where name = 'Rent';
update categories set icon = 'electricity' where name = 'Electricity';
update categories set icon = 'water'       where name = 'Water';
update categories set icon = 'wifi'        where name = 'Wifi';
update categories set icon = 'maid'        where name = 'Maid';
update categories set icon = 'gas'         where name = 'Gas Cylinder';
update categories set icon = 'supplies'    where name = 'Household Supplies';
update categories set icon = 'groceries'   where name = 'Groceries';
update categories set icon = 'milk'        where name = 'Milk';
update categories set icon = 'vegetables'  where name = 'Vegetables';
update categories set icon = 'dining'      where name = 'Eating Out';
update categories set icon = 'transport'   where name = 'Transport';
update categories set icon = 'misc'        where name = 'Misc';

-- Anything left over from the corrupted seed.
update categories set icon = 'misc'
 where icon is null or icon !~ '^[a-z]+$';

-- Future households get slugs from the start.
create or replace function create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from members where user_id = auth.uid() and left_on is null) then
    raise exception 'You already belong to a household';
  end if;

  insert into households (name) values (p_name) returning id into v_household;

  insert into members (household_id, user_id, display_name, role)
  values (v_household, auth.uid(), p_display_name, 'owner');

  insert into categories (household_id, name, icon, kind, respects_away_calendar, sort_order)
  values
    (v_household, 'Rent',               'rent',        'fixed',       false, 1),
    (v_household, 'Electricity',        'electricity', 'fixed',       false, 2),
    (v_household, 'Water',              'water',       'fixed',       false, 3),
    (v_household, 'Wifi',               'wifi',        'fixed',       false, 4),
    (v_household, 'Maid',               'maid',        'fixed',       false, 5),
    (v_household, 'Gas Cylinder',       'gas',         'bulk',        false, 6),
    (v_household, 'Household Supplies', 'supplies',    'bulk',        false, 7),
    (v_household, 'Groceries',          'groceries',   'consumption', true,  8),
    (v_household, 'Milk',               'milk',        'consumption', true,  9),
    (v_household, 'Vegetables',         'vegetables',  'consumption', true, 10),
    (v_household, 'Eating Out',         'dining',      'consumption', true, 11),
    (v_household, 'Transport',          'transport',   'consumption', true, 12),
    (v_household, 'Misc',               'misc',        'consumption', true, 13);

  insert into payment_methods (household_id, name)
  values (v_household, 'Cash'), (v_household, 'UPI'), (v_household, 'Card');

  return v_household;
end;
$$;

grant execute on function create_household(text, text) to authenticated;

commit;
