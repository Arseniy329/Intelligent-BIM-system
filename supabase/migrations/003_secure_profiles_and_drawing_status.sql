-- Apply after 001 and 002, including on projects where they have already run.
-- Role changes are reserved for trusted server-side administration.
create schema if not exists private;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

-- The registration trigger creates profiles. A client can edit only its email;
-- it cannot insert a profile with role=admin or update the role column.
drop policy if exists "profiles_insert_own" on public.profiles;
revoke insert, update on public.profiles from public, anon, authenticated;
grant update (email) on public.profiles to authenticated;

alter policy "profiles_select_own_or_admin" on public.profiles
using (id = (select auth.uid()) or (select private.is_admin()));

alter policy "profiles_update_own_or_admin" on public.profiles
using (id = (select auth.uid()) or (select private.is_admin()))
with check (id = (select auth.uid()) or (select private.is_admin()));

alter policy "drawings_select_own_or_admin" on public.drawings
using (owner_id = (select auth.uid()) or (select private.is_admin()));

alter policy "drawings_insert_own" on public.drawings
with check (owner_id = (select auth.uid()) or (select private.is_admin()));

alter policy "drawings_update_own_or_admin" on public.drawings
using (owner_id = (select auth.uid()) or (select private.is_admin()))
with check (owner_id = (select auth.uid()) or (select private.is_admin()));

alter policy "drawings_delete_own_or_admin" on public.drawings
using (owner_id = (select auth.uid()) or (select private.is_admin()));

alter policy "results_select_own_or_admin" on public.results
using (
  (select private.is_admin())
  or exists (
    select 1 from public.drawings as d
    where d.id = drawing_id and d.owner_id = (select auth.uid())
  )
);

alter policy "results_insert_own_or_admin" on public.results
with check (
  (select private.is_admin())
  or exists (
    select 1 from public.drawings as d
    where d.id = drawing_id and d.owner_id = (select auth.uid())
  )
);

alter policy "rules_select_admin_only" on public.rules
using ((select private.is_admin()));

alter policy "rules_insert_admin_only" on public.rules
with check ((select private.is_admin()));

alter policy "rules_update_admin_only" on public.rules
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy "rules_delete_admin_only" on public.rules
using ((select private.is_admin()));

alter policy "drawings_bucket_select_own_or_admin" on storage.objects
using (
  bucket_id = 'drawings'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or (select private.is_admin())
  )
);

alter policy "drawings_bucket_insert_own_or_admin" on storage.objects
with check (
  bucket_id = 'drawings'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or (select private.is_admin())
  )
);

alter policy "drawings_bucket_update_own_or_admin" on storage.objects
using (
  bucket_id = 'drawings'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or (select private.is_admin())
  )
)
with check (
  bucket_id = 'drawings'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or (select private.is_admin())
  )
);

alter policy "drawings_bucket_delete_own_or_admin" on storage.objects
using (
  bucket_id = 'drawings'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or (select private.is_admin())
  )
);

-- Match the shared DrawingStatus contract without dropping existing records.
alter table public.drawings drop constraint if exists drawings_status_check;
update public.drawings set status = 'error' where status = 'failed';
alter table public.drawings add constraint drawings_status_check
  check (status in ('pending', 'uploaded', 'processing', 'processed', 'error'));
