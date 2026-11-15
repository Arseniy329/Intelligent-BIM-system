create policy "drawings_bucket_select_own_or_admin"
on storage.objects
for select
using (
  bucket_id = 'drawings'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);

create policy "drawings_bucket_insert_own_or_admin"
on storage.objects
for insert
with check (
  bucket_id = 'drawings'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);

create policy "drawings_bucket_update_own_or_admin"
on storage.objects
for update
using (
  bucket_id = 'drawings'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
)
with check (
  bucket_id = 'drawings'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);

create policy "drawings_bucket_delete_own_or_admin"
on storage.objects
for delete
using (
  bucket_id = 'drawings'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);