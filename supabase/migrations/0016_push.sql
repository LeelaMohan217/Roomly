-- Push delivery for notifications.
--
-- Sent straight from Postgres with pg_net rather than a Supabase Edge
-- Function: an Edge Function would mean the CLI, a login and a deploy step
-- for a household app, and pg_net posts to Expo's endpoint just as well.
-- pg_net is asynchronous, so the HTTP call never blocks the insert.
--
-- Nothing here fails loudly if push isn't set up yet. With no registered
-- tokens it simply sends nothing, and the in-app feed carries on working.
--
-- The rupee sign is written as chr(8377) so this file stays pure ASCII --
-- non-ASCII characters have been corrupted in transit once already.

create extension if not exists pg_net with schema extensions;

create table if not exists push_tokens (
  member_id  uuid not null references members(id) on delete cascade,
  token      text not null,
  platform   text,
  updated_at timestamptz not null default now(),
  primary key (member_id, token)
);

alter table push_tokens enable row level security;

-- You may only register or remove your own device.
drop policy if exists push_tokens_own on push_tokens;
create policy push_tokens_own on push_tokens for all
  using (member_id = current_member())
  with check (member_id = current_member());

create or replace function register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_me uuid := current_member();
begin
  if v_me is null or p_token is null or length(trim(p_token)) = 0 then
    return;
  end if;

  -- A device can move between accounts; the token must follow the person
  -- currently signed in on it, not the one who first registered it.
  delete from push_tokens where token = p_token and member_id <> v_me;

  insert into push_tokens (member_id, token, platform)
  values (v_me, trim(p_token), p_platform)
  on conflict (member_id, token) do update set updated_at = now();
end;
$fn$;

create or replace function unregister_push_token(p_token text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  delete from push_tokens where token = p_token and member_id = current_member();
end;
$fn$;

-- ---------------------------------------------------------------------
-- Turning a notification row into a push message
-- ---------------------------------------------------------------------

create or replace function push_wording(
  p_kind    text,
  p_actor   text,
  p_subject text,
  p_amount  bigint
) returns jsonb
language plpgsql immutable as $fn$
declare
  v_money text := case
    when p_amount is null then ''
    else chr(8377) || trim(to_char(p_amount / 100.0, 'FM999999990.00'))
  end;
  v_who text := coalesce(p_actor, 'Someone');
begin
  return case p_kind
    when 'expense_added' then
      jsonb_build_object('title', v_who || ' added an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'expense_changed' then
      jsonb_build_object('title', v_who || ' changed an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' is now ' || v_money)
    when 'expense_deleted' then
      jsonb_build_object('title', v_who || ' deleted an expense',
                         'body',  coalesce(p_subject, 'Expense') || ' - ' || v_money)
    when 'settlement' then
      jsonb_build_object('title', 'Payment recorded',
                         'body',  coalesce(p_subject, '') || ' - ' || v_money)
    when 'member_added' then
      jsonb_build_object('title', 'New housemate',
                         'body',  v_who || ' added ' || coalesce(p_subject, 'someone'))
    when 'member_joined' then
      jsonb_build_object('title', coalesce(p_subject, 'Someone') || ' joined',
                         'body',  'They claimed their account')
    else
      jsonb_build_object('title', 'Roomly', 'body', 'Something changed in your household')
  end;
end;
$fn$;

/**
 * Fire-and-forget push for one notification. Called by notify_household()
 * after the row is written, so the in-app feed is never held up by, or
 * dependent on, push delivery succeeding.
 */
create or replace function send_push_for_notification(p_notification uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  n         record;
  v_actor   text;
  v_words   jsonb;
  v_messages jsonb;
begin
  select * into n from notifications where id = p_notification;
  if n is null then
    return;
  end if;

  select display_name into v_actor from members where id = n.actor_id;
  v_words := push_wording(n.kind, v_actor, n.subject, n.amount_paise);

  -- Everyone in the household with a registered device, except whoever did it.
  select jsonb_agg(
           jsonb_build_object(
             'to',    t.token,
             'title', v_words->>'title',
             'body',  v_words->>'body',
             'sound', 'default',
             'data',  jsonb_build_object(
                        'kind', n.kind,
                        'entityId', n.entity_id,
                        'notificationId', n.id
                      )
           )
         )
    into v_messages
    from push_tokens t
    join members m on m.id = t.member_id
   where m.household_id = n.household_id
     and m.left_on is null
     and (n.actor_id is null or t.member_id <> n.actor_id);

  if v_messages is null then
    return;  -- nobody has a device registered yet
  end if;

  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Accept', 'application/json'
               ),
    body    := v_messages
  );
end;
$fn$;

-- Hook it into the existing notification writer.
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

  if v_actor is not null then
    insert into notification_reads (notification_id, member_id)
    values (v_id, v_actor)
    on conflict do nothing;
  end if;

  -- Push must never be able to break the write that triggered it.
  begin
    perform send_push_for_notification(v_id);
  exception when others then
    null;
  end;
end;
$fn$;

grant execute on function register_push_token(text, text)   to authenticated;
grant execute on function unregister_push_token(text)       to authenticated;

-- Confirms it worked: all four should be true.
select
  (select count(*) from pg_extension where extname = 'pg_net')            = 1 as pg_net_enabled,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'push_tokens')         = 1 as tokens_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_push_token')     = 1 as register_fn,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'send_push_for_notification') = 1 as sender_fn;
