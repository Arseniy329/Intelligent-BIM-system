-- 1. profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'engineer' check (role in ('admin', 'engineer')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles
for select
using (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles_update_own_or_admin"
on public.profiles
for update
using (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- 2. trigger after auth user creation
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'engineer')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 3. drawings
create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  original_file_name text not null,
  storage_path text not null unique,
  units text not null,
  status text not null default 'pending' check (
    status in ('pending', 'uploaded', 'processing', 'processed', 'failed')
  ),
  created_at timestamptz not null default now()
);

alter table public.drawings enable row level security;

create policy "drawings_select_own_or_admin"
on public.drawings
for select
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "drawings_insert_own"
on public.drawings
for insert
with check (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "drawings_update_own_or_admin"
on public.drawings
for update
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "drawings_delete_own_or_admin"
on public.drawings
for delete
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- 4. results
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null unique references public.drawings(id) on delete cascade,
  data jsonb,
  output_file_path text,
  created_at timestamptz not null default now()
);

alter table public.results enable row level security;

create policy "results_select_own_or_admin"
on public.results
for select
using (
  exists (
    select 1
    from public.drawings d
    where d.id = drawing_id
      and (
        d.owner_id = auth.uid()
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'admin'
        )
      )
  )
);

create policy "results_insert_own_or_admin"
on public.results
for insert
with check (
  exists (
    select 1
    from public.drawings d
    where d.id = drawing_id
      and (
        d.owner_id = auth.uid()
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'admin'
        )
      )
  )
);

-- 5. rules
create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

alter table public.rules enable row level security;

create policy "rules_select_admin_only"
on public.rules
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "rules_insert_admin_only"
on public.rules
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "rules_update_admin_only"
on public.rules
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "rules_delete_admin_only"
on public.rules
for delete
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);