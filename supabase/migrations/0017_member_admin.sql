-- Roomly -- removing a housemate, and editing your own profile.
--
-- Two bugs of the same shape are fixed here, both caused by a missing RLS
-- policy rather than by any application code:
--
--   * members has SELECT, INSERT and UPDATE policies (0003_rls.sql:39-46) but
--     NO DELETE policy. Under RLS, a DELETE with no matching policy is not an
--     error -- it filters, deletes zero rows, and reports success. The owner
--     tapped the trash icon and the app cheerfully told them nothing.
--
--   * members_owner_update is owner-only, so a non-owner renaming themselves
--     would have failed the same silent way.
--
-- Both are fixed with SECURITY DEFINER functions rather than new policies.
-- That keeps the existing invariant that members are only ever changed through
-- a vetted function, and it stops anyone updating their own role to 'owner',
-- which a self-update policy would have to work hard to prevent.
--
-- Pure ASCII on purpose: non-ASCII characters in a migration have been
-- corrupted in transit on this project once already.
--
-- No transaction wrapper on purpose: migrations 0009 and 0010 silently rolled
-- back and cost two rounds of debugging before anyone noticed. The verification
-- SELECT at the bottom is how you confirm this actually applied.


-- ---------------------  remove a housemate  ---------------------
-- Delete if they are genuinely unused; otherwise mark them moved out so the
-- ledger keeps its history. Returns which of the two happened.

create or replace function remove_member(p_member_id uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_household uuid;
  v_target    members%rowtype;
  v_balance   bigint;
  v_used      boolean;
begin
  if not is_owner() then
    raise exception 'Only the owner can remove people from the household';
  end if;

  v_household := current_household();

  select * into v_target
    from members
   where id = p_member_id and household_id = v_household;

  if not found then
    raise exception 'That person is not in this household';
  end if;

  if v_target.id = current_member() then
    raise exception 'You cannot remove yourself. Transfer ownership first.';
  end if;

  if v_target.role = 'owner' then
    raise exception 'Transfer ownership before removing the owner';
  end if;

  -- Already gone. Idempotent so a double tap is harmless.
  if v_target.left_on is not null then
    return 'moved_out';
  end if;

  -- Any financial trace at all means the row has to survive: expense_splits
  -- carries no cascade precisely so history can never be rewritten.
  select exists (select 1 from expense_splits where member_id = p_member_id)
      or exists (select 1 from expenses
                  where paid_by = p_member_id or created_by = p_member_id)
      or exists (select 1 from settlements
                  where from_member = p_member_id or to_member = p_member_id)
      or exists (select 1 from pending_changes where requested_by = p_member_id)
    into v_used;

  if not v_used then
    -- A recurring rule naming them as payer is config, not history, but
    -- deleting them would break it. Say so rather than silently repointing it.
    if exists (select 1 from recurring_expenses where paid_by = p_member_id) then
      raise exception
        'They are the payer on a recurring bill. Change or delete that rule first.';
    end if;

    -- Non-financial rows that would otherwise block the delete. Safe to drop:
    -- someone with no expenses has no trips worth keeping.
    delete from away_periods      where member_id = p_member_id;
    delete from expense_templates where owner_member = p_member_id;
    delete from join_requests     where claim_member_id = p_member_id
                                    and status = 'pending';

    begin
      delete from members where id = p_member_id;
      return 'deleted';
    exception when foreign_key_violation then
      -- Something still references them that is not financial history and not
      -- enumerated above. Falling through to move-out is always safe.
      null;
    end;
  end if;

  -- member_balances (0005_views.sql) hides anyone with left_on set, and that
  -- view's stated canary is that balances per household sum to exactly zero.
  -- Moving out someone who is still owed money would drop their row from the
  -- view and so invent or destroy that money. Settle up first.
  select
      coalesce((select sum(e.total_paise) from expenses e
                 where e.paid_by = p_member_id and e.voided_at is null), 0)
    - coalesce((select sum(s.amount_paise) from expense_splits s
                 join expenses e2 on e2.id = s.expense_id
                where s.member_id = p_member_id and e2.voided_at is null), 0)
    + coalesce((select sum(t.amount_paise) from settlements t
                 where t.from_member = p_member_id and t.voided_at is null), 0)
    - coalesce((select sum(t.amount_paise) from settlements t
                 where t.to_member = p_member_id and t.voided_at is null), 0)
    into v_balance;

  if v_balance <> 0 then
    raise exception
      'Settle up with % first. Their balance is not zero, and removing them now would unbalance the ledger.',
      v_target.display_name;
  end if;

  -- left_on >= joined_on is a check constraint, so guard the same-day case
  -- where someone is added and removed before their join date.
  update members
     set left_on = greatest(current_date, v_target.joined_on)
   where id = p_member_id;

  return 'moved_out';
end;
$fn$;

comment on function remove_member(uuid) is
  'Owner-only. Hard-deletes a member with no financial history, otherwise '
  'marks them left_on. Refuses while their balance is non-zero, because '
  'member_balances excludes departed members and must always sum to zero.';


-- ---------------------  edit your own profile  ---------------------
-- Your name and avatar are yours. Everything else on a member row -- role,
-- household, joined_on, left_on -- stays owner-managed, which is why this
-- writes exactly two columns and nothing else.

create or replace function update_my_profile(
  p_display_name text,
  p_avatar_color text default null
)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_member uuid;
  v_name   text;
begin
  v_member := current_member();

  if v_member is null then
    raise exception 'You are not a member of a household';
  end if;

  v_name := btrim(coalesce(p_display_name, ''));

  if v_name = '' then
    raise exception 'Your name cannot be empty';
  end if;

  if length(v_name) > 40 then
    raise exception 'That name is too long';
  end if;

  if p_avatar_color is not null
     and p_avatar_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'That is not a colour';
  end if;

  update members
     set display_name = v_name,
         avatar_color = coalesce(p_avatar_color, avatar_color)
   where id = v_member;
end;
$fn$;

comment on function update_my_profile(text, text) is
  'Lets a member rename themselves and pick an avatar colour. Writes only '
  'those two columns, so role cannot be escalated through it.';


-- ---------------------------  verification  ---------------------------
-- Every column must read true. If any is false, this migration did not apply.

select
  (select count(*) from pg_proc
    where proname = 'remove_member') = 1          as remove_member_exists,
  (select count(*) from pg_proc
    where proname = 'update_my_profile') = 1      as update_my_profile_exists,
  (select bool_and(prosecdef) from pg_proc
    where proname in ('remove_member',
                      'update_my_profile'))       as both_security_definer,
  (select count(*) = 0 from ledger_imbalance())   as ledger_still_balances;
