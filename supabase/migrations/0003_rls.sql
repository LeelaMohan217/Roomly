-- Roomly -- row level security
--
-- Shape of the rules:
--   * every member can READ everything in their household. Shared money means
--     no secret ledger -- universal read is the foundation, not a feature.
--   * anyone can ADD an expense, in an open month, always.
--   * EDITING someone's expense goes through owner approval (pending_changes).
--     The owner may edit directly, since requiring self-approval is silly.
--   * config (members, categories, payment methods, invites) is owner-only.
--   * closed months are frozen for everyone.

begin;

alter table households        enable row level security;
alter table members           enable row level security;
alter table categories        enable row level security;
alter table payment_methods   enable row level security;
alter table periods           enable row level security;
alter table expenses          enable row level security;
alter table expense_splits    enable row level security;
alter table settlements       enable row level security;
alter table away_periods      enable row level security;
alter table invites           enable row level security;
alter table join_requests     enable row level security;
alter table pending_changes   enable row level security;
alter table audit_log         enable row level security;
alter table expense_templates enable row level security;

-- -------------------------  household  -------------------------

create policy households_read on households for select
  using (id = current_household());

create policy households_owner_update on households for update
  using (id = current_household() and is_owner());

-- --------------------------  members  --------------------------

create policy members_read on members for select
  using (household_id = current_household());

create policy members_owner_write on members for insert
  with check (household_id = current_household() and is_owner());

create policy members_owner_update on members for update
  using (household_id = current_household() and is_owner());

-- --------------------  owner-managed config  --------------------

create policy categories_read on categories for select
  using (household_id = current_household());

create policy categories_owner_write on categories for all
  using (household_id = current_household() and is_owner())
  with check (household_id = current_household() and is_owner());

create policy payment_methods_read on payment_methods for select
  using (household_id = current_household());

create policy payment_methods_owner_write on payment_methods for all
  using (household_id = current_household() and is_owner())
  with check (household_id = current_household() and is_owner());

create policy periods_read on periods for select
  using (household_id = current_household());

-- Periods are only ever created by the expense trigger and closed by the
-- close_period() function, both SECURITY DEFINER. No direct client writes.

-- --------------------------  expenses  --------------------------

create policy expenses_read on expenses for select
  using (household_id = current_household());

create policy expenses_insert on expenses for insert
  with check (
    household_id = current_household()
    and created_by = current_member()
    and period_is_open(period_id)
  );

-- Members cannot edit directly -- they raise a pending_change instead.
create policy expenses_owner_update on expenses for update
  using (
    household_id = current_household()
    and is_owner()
    and period_is_open(period_id)
  );

-- ---------------------------  splits  ---------------------------

create policy splits_read on expense_splits for select
  using (exists (
    select 1 from expenses e
    where e.id = expense_id and e.household_id = current_household()
  ));

create policy splits_write on expense_splits for all
  using (exists (
    select 1 from expenses e
    where e.id = expense_id
      and e.household_id = current_household()
      and period_is_open(e.period_id)
      and (e.created_by = current_member() or is_owner())
  ))
  with check (exists (
    select 1 from expenses e
    where e.id = expense_id
      and e.household_id = current_household()
      and period_is_open(e.period_id)
      and (e.created_by = current_member() or is_owner())
  ));

-- ------------------------  settlements  ------------------------

create policy settlements_read on settlements for select
  using (household_id = current_household());

create policy settlements_insert on settlements for insert
  with check (
    household_id = current_household()
    and created_by = current_member()
    and period_is_open(period_id)
  );

create policy settlements_owner_update on settlements for update
  using (household_id = current_household() and is_owner());

-- ----------------------  the away calendar  ----------------------
-- You manage your own trips. The owner can fix anyone's, because someone
-- will forget to mark themselves away until after they get back.

create policy away_read on away_periods for select
  using (household_id = current_household());

create policy away_write on away_periods for all
  using (
    household_id = current_household()
    and (member_id = current_member() or is_owner())
  )
  with check (
    household_id = current_household()
    and (member_id = current_member() or is_owner())
  );

-- ----------------------------  invites  ----------------------------
-- Codes are readable only by the owner who issued them. People joining
-- never SELECT this table -- they go through preview_invite()/request_join().

create policy invites_owner_all on invites for all
  using (household_id = current_household() and is_owner())
  with check (household_id = current_household() and is_owner());

-- ----------------------  join requests  ----------------------
-- The requester can watch their own row (that's how the waiting screen
-- advances by itself over Realtime). The owner sees all of them.

create policy join_requests_read on join_requests for select
  using (user_id = auth.uid() or (household_id = current_household() and is_owner()));

create policy join_requests_cancel on join_requests for update
  using (user_id = auth.uid() and status = 'pending')
  with check (status = 'cancelled');

-- ---------------------  approvals & history  ---------------------

create policy pending_read on pending_changes for select
  using (household_id = current_household());

create policy pending_insert on pending_changes for insert
  with check (
    household_id = current_household()
    and requested_by = current_member()
    and status = 'pending'
  );

create policy pending_owner_review on pending_changes for update
  using (household_id = current_household() and is_owner());

-- Everyone reads the history; nobody writes it but the triggers.
create policy audit_read on audit_log for select
  using (household_id = current_household());

revoke insert, update, delete on audit_log from authenticated, anon;

-- ---------------------------  templates  ---------------------------

create policy templates_read on expense_templates for select
  using (household_id = current_household());

create policy templates_write on expense_templates for all
  using (
    household_id = current_household()
    and (owner_member is null or owner_member = current_member() or is_owner())
  )
  with check (household_id = current_household());

commit;
