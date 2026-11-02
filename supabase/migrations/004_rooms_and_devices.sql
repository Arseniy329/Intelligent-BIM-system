create extension if not exists "uuid-ossp";

-- 1) rooms
create table if not exists public.rooms (
  id uuid primary key default uuid_generate_v4(),
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  name text,
  type text,
  type_confirmed boolean not null default false,
  source text not null default 'manual' check (source in ('auto', 'fire_rooms', 'manual')),
  confirmed boolean not null default false,
  height numeric,
  area numeric not null default 0,
  polygon jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rooms_drawing_id on public.rooms(drawing_id);

-- 2) devices — align with current contract + keep compatibility
alter table public.devices
  add column if not exists drawing_id uuid;

alter table public.devices
  add column if not exists room_id uuid;

alter table public.devices
  add column if not exists type text;

alter table public.devices
  add column if not exists layer text;

alter table public.devices
  add column if not exists rule_id uuid;

-- ensure drawing_id references drawings
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'devices_drawing_id_fkey'
  ) then
    alter table public.devices
      add constraint devices_drawing_id_fkey
      foreign key (drawing_id) references public.drawings(id) on delete cascade;
  end if;
end $$;

-- constrain device type to supported values
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'devices_type_check'
  ) then
    alter table public.devices
      add constraint devices_type_check
      check (
        type in (
          'smoke_detector',
          'heat_detector',
          'sounder',
          'manual_call_point'
        )
      );
  end if;
end $$;

-- if you want to keep old x/y for compatibility, leave them
-- but for new contract the main shape is `drawing_id + room_id + type + layer + rule_id`

create index if not exists idx_devices_drawing_id on public.devices(drawing_id);

-- 3) enable RLS
alter table public.rooms enable row level security;
alter table public.devices enable row level security;

-- 4) policies for rooms
create policy if not exists "rooms_select_own_or_admin"
on public.rooms
for select
using (
  exists (
    select 1
    from public.drawings d
    where d.id = rooms.drawing_id
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

create policy if not exists "rooms_insert_own_or_admin"
on public.rooms
for insert
with check (
  exists (
    select 1
    from public.drawings d
    where d.id = rooms.drawing_id
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

create policy if not exists "rooms_update_own_or_admin"
on public.rooms
for update
using (
  exists (
    select 1
    from public.drawings d
    where d.id = rooms.drawing_id
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
)
with check (
  exists (
    select 1
    from public.drawings d
    where d.id = rooms.drawing_id
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

create policy if not exists "rooms_delete_own_or_admin"
on public.rooms
for delete
using (
  exists (
    select 1
    from public.drawings d
    where d.id = rooms.drawing_id
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

-- 5) policies for devices
create policy if not exists "devices_select_own_or_admin"
on public.devices
for select
using (
  exists (
    select 1
    from public.drawings d
    where d.id = devices.drawing_id
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

create policy if not exists "devices_insert_own_or_admin"
on public.devices
for insert
with check (
  exists (
    select 1
    from public.drawings d
    where d.id = devices.drawing_id
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

create policy if not exists "devices_update_own_or_admin"
on public.devices
for update
using (
  exists (
    select 1
    from public.drawings d
    where d.id = devices.drawing_id
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
)
with check (
  exists (
    select 1
    from public.drawings d
    where d.id = devices.drawing_id
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

create policy if not exists "devices_delete_own_or_admin"
on public.devices
for delete
using (
  exists (
    select 1
    from public.drawings d
    where d.id = devices.drawing_id
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