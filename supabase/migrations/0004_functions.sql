-- Roomly -- the operations RLS deliberately cannot express.
--
-- Everything here is SECURITY DEFINER because the caller is either not yet a
-- member (joining) or is performing a privileged action that needs checking in
-- procedural code rather than a policy. Each one validates its own caller --
-- that check is the only thing standing between a stranger and your ledger.

-- -----------------  create a household (first run)  -----------------
-- A brand new user has no member row, so RLS blocks every insert. This is
-- the one door in.

begin;

create or replace function create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_household uuid;
  v_member    uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from members where user_id = auth.uid() and left_on is null) then
    raise exception 'You already belong to a household';
  end if;

  insert into households (name) values (p_name) returning id into v_household;

  insert into members (household_id, user_id, display_name, role)
  values (v_household, auth.uid(), p_display_name, 'owner')
  returning id into v_member;

  -- Ship with sensible categories already flagged. A blank slate is a bad
  -- first experience, and people pick the wrong `kind` when guessing.
  insert into categories (household_id, name, icon, kind, respects_away_calendar, sort_order)
  values
    (v_household, 'Rent',               'rent', 'fixed',       false, 1),
    (v_household, 'Electricity',        'electricity', 'fixed',       false, 2),
    (v_household, 'Water',              'water', 'fixed',       false, 3),
    (v_household, 'Wifi',               'wifi', 'fixed',       false, 4),
    (v_household, 'Maid',               'maid', 'fixed',       false, 5),
    (v_household, 'Gas Cylinder',       'gas', 'bulk',        false, 6),
    (v_household, 'Household Supplies', 'supplies', 'bulk',        false, 7),
    (v_household, 'Groceries',          'groceries', 'consumption', true,  8),
    (v_household, 'Milk',               'milk', 'consumption', true,  9),
    (v_household, 'Vegetables',         'vegetables', 'consumption', true, 10),
    (v_household, 'Eating Out',         'dining', 'consumption', true, 11),
    (v_household, 'Transport',          'transport', 'consumption', true, 12),
    (v_household, 'Misc',               'misc', 'consumption', true, 13);

  insert into payment_methods (household_id, name)
  values (v_household, 'Cash'), (v_household, 'UPI'), (v_household, 'Card');

  return v_household;
end;
$$;

-- ---------------  add a housemate before they install  ---------------
-- Placeholder members let you start logging tonight instead of waiting for
-- three friends to install an app on the same evening.

create or replace function add_placeholder_member(p_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
begin
  if not is_owner() then
    raise exception 'Only the owner can add members';
  end if;

  insert into members (household_id, display_name, invited_email)
  values (current_household(), p_name, p_email)
  returning id into v_member;

  return v_member;
end;
$$;

-- ----------------------------  invites  ----------------------------

create or replace function gen_invite_code()
returns text language plpgsql as $$
declare
  -- No I, L, O, 0 or 1 -- these get misread when someone types a code
  -- off a WhatsApp message.
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code     text := '';
begin
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return substr(code, 1, 3) || '-' || substr(code, 4, 3);
end;
$$;

create or replace function create_invite(p_max_uses smallint default 1, p_valid_days int default 7)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not is_owner() then
    raise exception 'Only the owner can create invites';
  end if;

  for attempt in 1..10 loop
    v_code := gen_invite_code();
    begin
      insert into invites (code, household_id, created_by, expires_at, max_uses)
      values (v_code, current_household(), current_member(),
              now() + (p_valid_days || ' days')::interval, p_max_uses);
      return v_code;
    exception when unique_violation then
      -- vanishingly unlikely; just roll again
    end;
  end loop;

  raise exception 'Could not allocate an invite code';
end;
$$;

-- What a prospective member sees before committing: the house name and which
-- placeholder rows they might be. Deliberately returns nothing else -- a code
-- must not expose the ledger.

create or replace function preview_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invite  invites;
  v_house   text;
  v_claims  jsonb;
begin
  select * into v_invite from invites where code = upper(trim(p_code));

  if v_invite is null then
    raise exception 'That code does not exist';
  elsif v_invite.revoked_at is not null then
    raise exception 'That code has been revoked';
  elsif v_invite.expires_at < now() then
    raise exception 'That code has expired';
  elsif v_invite.used_count >= v_invite.max_uses then
    raise exception 'That code has already been used';
  end if;

  select name into v_house from households where id = v_invite.household_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name)), '[]'::jsonb)
    into v_claims
    from members
   where household_id = v_invite.household_id
     and user_id is null
     and left_on is null;

  return jsonb_build_object(
    'household_name', v_house,
    'claimable',      v_claims
  );
end;
$$;

-- ----------------  join: request, then owner approves  ----------------

create or replace function request_join(p_code text, p_name text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
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

  if exists (select 1 from members
              where user_id = auth.uid() and household_id = v_invite.household_id) then
    raise exception 'You are already a member of this household';
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
$$;

create or replace function review_join_request(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req join_requests;
begin
  select * into v_req from join_requests where id = p_request;
  if v_req is null then
    raise exception 'No such request';
  end if;
  if v_req.household_id <> current_household() or not is_owner() then
    raise exception 'Only the owner of this household can review join requests';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'That request has already been reviewed';
  end if;

  if p_approve then
    if v_req.claim_member_id is not null then
      -- Claiming an existing placeholder inherits all its history.
      update members
         set user_id = v_req.user_id, display_name = v_req.display_name
       where id = v_req.claim_member_id and user_id is null;

      if not found then
        raise exception 'That member has already been claimed';
      end if;
    else
      insert into members (household_id, user_id, display_name)
      values (v_req.household_id, v_req.user_id, v_req.display_name);
    end if;

    -- Consumed on approval, not on request, so a rejection doesn't burn
    -- a single-use code.
    update invites set used_count = used_count + 1 where code = v_req.invite_code;
  end if;

  update join_requests
     set status      = case when p_approve then 'approved' else 'rejected' end::join_status,
         reviewed_by = current_member(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_request;
end;
$$;

-- -----------------  edits that need owner sign-off  -----------------

create or replace function review_pending_change(p_change uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_change pending_changes;
  v_split  jsonb;
begin
  select * into v_change from pending_changes where id = p_change;
  if v_change is null then
    raise exception 'No such change';
  end if;
  if v_change.household_id <> current_household() or not is_owner() then
    raise exception 'Only the owner can review changes';
  end if;
  if v_change.status <> 'pending' then
    raise exception 'That change has already been reviewed';
  end if;

  if p_approve and v_change.entity_type = 'expense' then
    if v_change.kind = 'void' then
      update expenses
         set voided_at = now(), voided_by = current_member(),
             void_reason = coalesce(v_change.reason, p_note)
       where id = v_change.entity_id;
    else
      update expenses
         set total_paise       = coalesce((v_change.payload->>'total_paise')::bigint, total_paise),
             description       = coalesce( v_change.payload->>'description', description),
             category_id       = coalesce((v_change.payload->>'category_id')::uuid, category_id),
             payment_method_id = coalesce((v_change.payload->>'payment_method_id')::uuid, payment_method_id),
             expense_date      = coalesce((v_change.payload->>'expense_date')::date, expense_date)
       where id = v_change.entity_id;

      -- Splits are replaced wholesale; the deferred balance trigger checks
      -- the result at commit.
      if v_change.payload ? 'splits' then
        delete from expense_splits where expense_id = v_change.entity_id;
        for v_split in select * from jsonb_array_elements(v_change.payload->'splits') loop
          insert into expense_splits (expense_id, member_id, amount_paise)
          values (v_change.entity_id,
                  (v_split->>'member_id')::uuid,
                  (v_split->>'amount_paise')::bigint);
        end loop;
      end if;
    end if;
  end if;

  update pending_changes
     set status      = case when p_approve then 'approved' else 'rejected' end::change_status,
         reviewed_by = current_member(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_change;
end;
$$;

-- ----------------------  close out a month  ----------------------

create or replace function close_period(p_period uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can close a month';
  end if;
  if not exists (select 1 from periods where id = p_period and household_id = current_household()) then
    raise exception 'No such period in this household';
  end if;
  if exists (select 1 from pending_changes
              where household_id = current_household() and status = 'pending') then
    raise exception 'Resolve the pending changes before closing the month';
  end if;

  update periods
     set status = 'closed', closed_at = now(), closed_by = current_member()
   where id = p_period;
end;
$$;

create or replace function reopen_period(p_period uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can reopen a month';
  end if;

  update periods set status = 'open', closed_at = null, closed_by = null
   where id = p_period and household_id = current_household();
end;
$$;

-- ----------------------------  grants  ----------------------------

revoke execute on all functions in schema public from anon;

grant execute on function
  create_household(text, text),
  add_placeholder_member(text, text),
  create_invite(smallint, int),
  preview_invite(text),
  request_join(text, text, uuid),
  review_join_request(uuid, boolean, text),
  review_pending_change(uuid, boolean, text),
  close_period(uuid),
  reopen_period(uuid)
to authenticated;

commit;
