-- Roomly -- profile photos.
--
-- A member can put a photo on their own avatar, shown wherever their initials
-- used to be. Three pieces:
--
--   members.avatar_path   where the photo is in storage, or null for none.
--   bucket 'avatars'      the files, at <household_id>/<member_id>/<file>.
--                         Public-read, so the app can show them by URL
--                         without signing each one; the path is two uuids,
--                         so a URL cannot be guessed.
--   set_my_photo(p_path)  points YOUR avatar at a file in YOUR folder, or
--                         clears it with null. Signed-in only.
--
-- Writes to the bucket are limited to your own folder by the policies below,
-- and set_my_photo refuses a path outside it, so nobody can put a photo on
-- someone else's avatar -- by upload or by pointing at another file.
--
-- The app reads avatar_path in a query of its own and treats a failure as "no
-- photos", so a build that ships before this runs does not break; photos just
-- appear once it has.
--
-- No begin/commit wrapper, per 0011's header. Check the SELECT at the bottom.


alter table members add column if not exists avatar_path text;


-- 2 MB, images only. The app crops to a square and compresses before upload,
-- so a real photo comes in far under this.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- Your own folder only: the first segment is your household, the second is
-- you. current_member() and current_household() are open to authenticated
-- (0034's allowlist), which is what lets a policy call them.
drop policy if exists "avatars: upload your own" on storage.objects;
create policy "avatars: upload your own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_household()::text
    and (storage.foldername(name))[2] = public.current_member()::text
  );

drop policy if exists "avatars: replace your own" on storage.objects;
create policy "avatars: replace your own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_household()::text
    and (storage.foldername(name))[2] = public.current_member()::text
  );

drop policy if exists "avatars: delete your own" on storage.objects;
create policy "avatars: delete your own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_household()::text
    and (storage.foldername(name))[2] = public.current_member()::text
  );


create or replace function set_my_photo(p_path text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_member    uuid := current_member();
  v_household uuid := current_household();
begin
  if v_member is null then
    raise exception 'You are not a member of a household';
  end if;

  if p_path is not null
     and p_path not like v_household::text || '/' || v_member::text || '/%' then
    raise exception 'That photo is not yours';
  end if;

  update members set avatar_path = p_path where id = v_member;
end;
$fn$;

comment on function set_my_photo(text) is
  'Points the caller''s avatar at a photo in their own storage folder, or clears it. '
  'Writes only avatar_path.';

-- New functions start closed since 0034.
grant execute on function set_my_photo(text) to authenticated;


-- ---------------------------  verification  ---------------------------
-- Every column must read true. If any is false, this migration did not apply.

select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'members'
             and column_name = 'avatar_path')                          as avatar_path_exists,
  exists (select 1 from storage.buckets where id = 'avatars' and public) as avatars_bucket_public,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'avatars:%') = 3                             as three_avatar_policies,
  has_function_privilege('authenticated', 'set_my_photo(text)', 'execute') as set_my_photo_open,
  not has_function_privilege('anon', 'set_my_photo(text)', 'execute')      as anon_cannot_set_photo,
  (select count(*) = 0 from ledger_imbalance())                        as ledger_still_balances;
