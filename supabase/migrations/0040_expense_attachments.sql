-- Roomly -- bill photos on an expense.
--
-- A photo or screenshot of the bill, attached when the expense is added or
-- later from its screen, so the housemate approving it (0039) can see what it
-- was for. Three pieces, following 0037's avatars:
--
--   bucket 'expense-attachments'   the files, at <household_id>/<member_id>/<file>.
--                                  PRIVATE, unlike avatars: a bill can carry an
--                                  address, a card's last digits, what was
--                                  bought. Only the household can read them,
--                                  and the app shows them through signed URLs.
--   table expense_attachments      which file belongs to which expense, and who
--                                  put it there.
--   at most five per expense       a trigger, so it holds whatever writes.
--
-- Uploads go into YOUR folder only, as with avatars. Any housemate may attach
-- a photo to any expense in the household -- a photo moves no money, and the
-- person holding the paper bill is often not the one who typed it in. Only the
-- person who attached it, or the owner, may remove it.
--
-- Photos are allowed on expenses in a closed month too, for the same reason.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


-- ---------------------------  the files  ---------------------------

-- 5 MB, images only. The app compresses before upload, so a phone photo of a
-- receipt comes in far under this.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-attachments', 'expense-attachments', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading: anyone in the household. The first folder is the household.
drop policy if exists "expense-attachments: household reads" on storage.objects;
create policy "expense-attachments: household reads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-attachments'
    and (storage.foldername(name))[1] = public.current_household()::text
  );

-- Writing: your own folder only.
drop policy if exists "expense-attachments: upload your own" on storage.objects;
create policy "expense-attachments: upload your own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-attachments'
    and (storage.foldername(name))[1] = public.current_household()::text
    and (storage.foldername(name))[2] = public.current_member()::text
  );

-- Removing: your own, or anything in the household if you are the owner.
drop policy if exists "expense-attachments: delete your own" on storage.objects;
create policy "expense-attachments: delete your own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expense-attachments'
    and (storage.foldername(name))[1] = public.current_household()::text
    and (
      (storage.foldername(name))[2] = public.current_member()::text
      or public.is_owner()
    )
  );


-- ---------------------------  the links  ---------------------------

create table if not exists expense_attachments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  expense_id   uuid not null references expenses(id) on delete cascade,
  path         text not null unique,
  uploaded_by  uuid not null references members(id),
  created_at   timestamptz not null default now()
);

-- The expense screen: its photos, in the order they were added.
create index if not exists expense_attachments_expense_idx
  on expense_attachments (expense_id, created_at);

comment on table expense_attachments is
  'Bill photos. path is the object name in the expense-attachments bucket, '
  'always <household_id>/<uploaded_by>/<file>. At most five per expense.';

alter table expense_attachments enable row level security;

drop policy if exists attachments_read on expense_attachments;
create policy attachments_read on expense_attachments for select
  using (household_id = current_household());

-- The path must be in your own folder, so a row cannot point at somebody
-- else's file, and the expense must be in your household.
drop policy if exists attachments_insert on expense_attachments;
create policy attachments_insert on expense_attachments for insert
  with check (
    household_id = current_household()
    and uploaded_by = current_member()
    and path like current_household()::text || '/' || current_member()::text || '/%'
    and exists (select 1 from expenses e
                 where e.id = expense_id and e.household_id = current_household())
  );

drop policy if exists attachments_delete on expense_attachments;
create policy attachments_delete on expense_attachments for delete
  using (
    household_id = current_household()
    and (uploaded_by = current_member() or is_owner())
  );

-- No update policy: a photo is added or removed, never repointed.


-- Five per expense. The lock makes two uploads racing for the fifth slot take
-- turns, so the count is exact.
create or replace function check_attachment_limit()
returns trigger language plpgsql set search_path = public as $fn$
begin
  perform pg_advisory_xact_lock(hashtext('expense_attachments:' || new.expense_id::text));

  if (select count(*) from expense_attachments where expense_id = new.expense_id) >= 5 then
    raise exception 'An expense can have at most 5 photos.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists attachments_limit on expense_attachments;
create trigger attachments_limit
  before insert on expense_attachments
  for each row execute function check_attachment_limit();


-- ---------------------------  verification  ---------------------------
-- Every column must read true. If any is false, this migration did not apply.

select
  exists (select 1 from storage.buckets
           where id = 'expense-attachments' and not public)                  as bucket_is_private,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'expense-attachments:%') = 3                       as three_storage_policies,
  (select relrowsecurity from pg_class where relname = 'expense_attachments') as table_has_rls,
  (select count(*) from pg_policies
    where tablename = 'expense_attachments') = 3                             as three_table_policies,
  exists (select 1 from pg_trigger where tgname = 'attachments_limit')       as limit_installed,
  (select count(*) = 0 from ledger_imbalance())                              as ledger_still_balances;
