-- Fix: a household could never be deleted.
--
-- check_owner_remains() fired on the cascade that removes its members and
-- insisted an owner still existed -- for a household that was itself being
-- deleted in the same transaction. The trigger is deferred, so by commit
-- time the household row is gone; checking for it first is enough.

begin;

create or replace function check_owner_remains()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_household uuid := coalesce(new.household_id, old.household_id);
begin
  if not exists (select 1 from households where id = v_household) then
    return null;
  end if;

  if not exists (
    select 1 from members
    where household_id = v_household and role = 'owner' and left_on is null
  ) then
    raise exception 'A household must always have at least one active owner';
  end if;
  return null;
end;
$$;

commit;
