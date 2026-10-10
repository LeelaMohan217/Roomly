-- Notifications: everyone sees what everyone else did.
--
-- Rows carry STRUCTURED data (kind, amount_paise, subject) rather than a
-- rendered sentence. Formatting money in SQL would duplicate money.ts and
-- the two would drift; the client builds the wording from these fields.
--
-- Written only by triggers. The actor is marked read at creation, so you are
-- never notified about your own action but it still appears in the feed.
--
-- No transaction wrapper: idempotent DDL, so a failure stops visibly.

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  kind         text not null check (kind in (
    'expense_added', 'expense_changed', 'expense_deleted',
    'settlement', 'member_added', 'member_joined'
  )),
  actor_id     uuid references members(id) on delete set null,
  /** The expense/settlement/member this is about, for tapping through. */
  entity_id    uuid,
  amount_paise bigint,
  subject      text,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_household_idx
  on notifications (household_id, created_at desc);

create table if not exists notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  member_id       uuid not null references members(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, member_id)
);

alter table notifications      enable row level security;
alter table notification_reads enable row level security;

drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select
  using (household_id = current_household());

drop policy if exists reads_select on notification_reads;
create policy reads_select on notification_reads for select
  using (member_id = current_member());

-- You may only ever mark your own notifications read.
drop policy if exists reads_insert on notification_reads;
create policy reads_insert on notification_reads for insert
  with check (member_id = current_member());

-- ---------------------------------------------------------------------
-- Trigger helpers
-- ---------------------------------------------------------------------

create or replace function notify_household(
  p_household uuid,
  p_kind      text,
  p_entity    uuid,
  p_amount    bigint,
  p_subject   text
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := current_member();
  v_id    uuid;
begin
  insert into notifications (household_id, kind, actor_id, entity_id, amount_paise, subject)
  values (p_household, p_kind, v_actor, p_entity, p_amount, p_subject)
  returning id into v_id;

  -- The person who did it doesn't need telling.
  if v_actor is not null then
    insert into notification_reads (notification_id, member_id)
    values (v_id, v_actor)
    on conflict do nothing;
  end if;
end;
$fn$;

create or replace function notify_expense()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_label text;
begin
  select coalesce(nullif(trim(coalesce(new.description, '')), ''), c.name)
    into v_label
    from categories c where c.id = new.category_id;

  if tg_op = 'INSERT' then
    perform notify_household(new.household_id, 'expense_added', new.id, new.total_paise, v_label);
  elsif old.voided_at is null and new.voided_at is not null then
    perform notify_household(new.household_id, 'expense_deleted', new.id, new.total_paise, v_label);
  elsif old.total_paise <> new.total_paise or old.category_id <> new.category_id then
    -- Only a meaningful change is worth interrupting people for.
    perform notify_household(new.household_id, 'expense_changed', new.id, new.total_paise, v_label);
  end if;

  return null;
end;
$fn$;

drop trigger if exists expenses_notify on expenses;
create trigger expenses_notify
  after insert or update on expenses
  for each row execute function notify_expense();

create or replace function notify_settlement()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_from text;
  v_to   text;
begin
  select display_name into v_from from members where id = new.from_member;
  select display_name into v_to   from members where id = new.to_member;

  perform notify_household(
    new.household_id, 'settlement', new.id, new.amount_paise,
    coalesce(v_from, '?') || ' -> ' || coalesce(v_to, '?')
  );
  return null;
end;
$fn$;

drop trigger if exists settlements_notify on settlements;
create trigger settlements_notify
  after insert on settlements
  for each row execute function notify_settlement();

create or replace function notify_member()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    perform notify_household(new.household_id, 'member_added', new.id, null, new.display_name);
  elsif old.user_id is null and new.user_id is not null then
    -- A placeholder just became a real person with an account.
    perform notify_household(new.household_id, 'member_joined', new.id, null, new.display_name);
  end if;
  return null;
end;
$fn$;

drop trigger if exists members_notify on members;
create trigger members_notify
  after insert or update on members
  for each row execute function notify_member();

-- Marking the whole feed read in one statement.
create or replace function mark_notifications_read()
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_me    uuid := current_member();
  v_count int;
begin
  if v_me is null then
    return 0;
  end if;

  insert into notification_reads (notification_id, member_id)
  select n.id, v_me
    from notifications n
   where n.household_id = current_household()
     and not exists (
       select 1 from notification_reads r
        where r.notification_id = n.id and r.member_id = v_me
     )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

grant execute on function mark_notifications_read() to authenticated;

-- Confirms it worked: all four should be true.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'notifications')       = 1 as notifications_table,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'notification_reads')  = 1 as reads_table,
  (select count(*) from pg_trigger where tgname = 'expenses_notify')      = 1 as expense_trigger,
  (select count(*) from pg_trigger where tgname = 'members_notify')       = 1 as member_trigger;
