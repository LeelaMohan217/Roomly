-- Roomly -- core schema
-- Money is always integer paise. Deletes are always soft.

begin;

create extension if not exists btree_gist;

-- -----------------------------  types  -----------------------------

create type member_role   as enum ('owner', 'member');
create type category_kind as enum ('fixed', 'consumption', 'bulk', 'asset');
create type period_status as enum ('open', 'closed');
create type change_status as enum ('pending', 'approved', 'rejected');
create type change_kind   as enum ('update', 'void');
create type join_status   as enum ('pending', 'approved', 'rejected', 'cancelled');

-- -------------------------  household & people  --------------------

create table households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  currency       char(3) not null default 'INR',
  settlement_day smallint not null default 1
                 check (settlement_day between 1 and 28),
  created_at     timestamptz not null default now()
);

-- user_id is null until that person installs the app and claims the row,
-- so you can create all four members and start logging on day one.
create table members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid unique references auth.users(id) on delete set null,
  display_name  text not null,
  avatar_color  text not null default '#888888',
  role          member_role not null default 'member',
  joined_on     date not null default current_date,
  left_on       date,
  invited_email text,
  created_at    timestamptz not null default now(),
  check (left_on is null or left_on >= joined_on)
);
create index members_household_idx on members (household_id);

-- ------------------------  owner-managed config  -------------------

create table categories (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references households(id) on delete cascade,
  name                   text not null,
  icon                   text,
  kind                   category_kind not null,
  -- Only consumption categories skip people who were away. Rent and the
  -- gas cylinder are owed by everyone, present or not.
  respects_away_calendar boolean not null,
  sort_order             smallint not null default 0,
  is_archived            boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (household_id, name)
);

create table payment_methods (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  is_archived  boolean not null default false,
  unique (household_id, name)
);

-- -----------------------------  periods  ---------------------------

create table periods (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  year         smallint not null,
  month        smallint not null check (month between 1 and 12),
  status       period_status not null default 'open',
  closed_at    timestamptz,
  closed_by    uuid references members(id),
  unique (household_id, year, month)
);

-- ---------------------------  the ledger  --------------------------

create table expenses (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  period_id         uuid not null references periods(id),
  paid_by           uuid not null references members(id),
  total_paise       bigint not null check (total_paise > 0),
  description       text,
  category_id       uuid not null references categories(id),
  payment_method_id uuid references payment_methods(id),
  expense_date      date not null,
  created_by        uuid not null references members(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  rev               integer not null default 1,
  voided_at         timestamptz,
  voided_by         uuid references members(id),
  void_reason       text
);
create index expenses_date_idx   on expenses (household_id, expense_date desc);
create index expenses_period_idx on expenses (period_id);
create index expenses_payer_idx  on expenses (paid_by) where voided_at is null;

create table expense_splits (
  expense_id   uuid not null references expenses(id) on delete cascade,
  member_id    uuid not null references members(id),
  amount_paise bigint not null check (amount_paise >= 0),
  primary key (expense_id, member_id)
);
create index splits_member_idx on expense_splits (member_id);

create table settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  period_id    uuid not null references periods(id),
  from_member  uuid not null references members(id),
  to_member    uuid not null references members(id),
  amount_paise bigint not null check (amount_paise > 0),
  settled_on   date not null default current_date,
  note         text,
  created_by   uuid not null references members(id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  check (from_member <> to_member)
);
create index settlements_household_idx on settlements (household_id);

-- ------------------------- the away calendar -----------------------

create table away_periods (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  member_id    uuid not null references members(id),
  start_date   date not null,
  end_date     date,
  note         text,
  created_at   timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  -- One member cannot have two overlapping away periods. Makes a whole
  -- class of "why is Kiran double-excluded?" bug structurally impossible.
  exclude using gist (
    member_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  )
);
create index away_member_idx on away_periods (member_id, start_date);

-- ---------------------  invites & join requests  -------------------

create table invites (
  code         text primary key,
  household_id uuid not null references households(id) on delete cascade,
  created_by   uuid not null references members(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  max_uses     smallint not null default 1,
  used_count   smallint not null default 0,
  revoked_at   timestamptz
);

create table join_requests (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  invite_code     text not null references invites(code),
  user_id         uuid not null references auth.users(id) on delete cascade,
  display_name    text not null,
  email           text,
  claim_member_id uuid references members(id),
  status          join_status not null default 'pending',
  requested_at    timestamptz not null default now(),
  reviewed_by     uuid references members(id),
  reviewed_at     timestamptz,
  review_note     text
);
-- one live request per person, and no two people racing for one placeholder
create unique index join_one_pending_per_user on join_requests (household_id, user_id)
  where status = 'pending';
create unique index join_one_pending_per_claim on join_requests (claim_member_id)
  where status = 'pending' and claim_member_id is not null;

-- ----------------------  approvals & history  ----------------------

create table pending_changes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  entity_type  text not null check (entity_type in ('expense', 'settlement')),
  entity_id    uuid not null,
  kind         change_kind not null,
  payload      jsonb not null,
  reason       text,
  requested_by uuid not null references members(id),
  requested_at timestamptz not null default now(),
  status       change_status not null default 'pending',
  reviewed_by  uuid references members(id),
  reviewed_at  timestamptz,
  review_note  text
);
create unique index pending_one_per_entity on pending_changes (entity_id)
  where status = 'pending';

-- Written by trigger, readable by everyone, writable by no one. This is what
-- makes "the owner may edit, but never silently" true at the database level.
create table audit_log (
  id           bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  action       text not null,
  actor_id     uuid references members(id),
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);
create index audit_entity_idx on audit_log (entity_type, entity_id, created_at desc);

-- ----------------------  quick-entry templates  --------------------

create table expense_templates (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner_member uuid references members(id),   -- null = shared with the house
  label        text not null,
  amount_paise bigint check (amount_paise > 0),
  category_id  uuid not null references categories(id),
  is_pinned    boolean not null default false,
  use_count    integer not null default 0
);

commit;
