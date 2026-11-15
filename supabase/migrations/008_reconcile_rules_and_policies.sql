-- 008_reconcile_rules_and_policies.sql
-- Forward-only idempotent migration to reconcile rules table defaults,
-- trigger synchronization, and RLS policies on rooms and devices for
-- databases that have already applied migrations 001..007.

-- 1. Ensure rules table schema and constraints
create extension if not exists "uuid-ossp";

alter table public.rules
  add column if not exists document text,
  add column if not exists clause text,
  add column if not exists conditions jsonb not null default '{}',
  add column if not exists threshold numeric check (threshold > 0),
  add column if not exists status text not null default 'needs_review',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists rule_id text,
  add column if not exists device_type text,
  add column if not exists value numeric,
  add column if not exists value_kind text,
  add column if not exists room_types text[] not null default '{}',
  add column if not exists min_height_m numeric,
  add column if not exists max_height_m numeric,
  add column if not exists source_url text,
  add column if not exists verification_status text not null default 'needs_review';

-- Ensure legacy rules have rule_id set before setting NOT NULL
update public.rules
set rule_id = 'LEGACY-' || id::text
where rule_id is null;

-- Backfill threshold and value if null
update public.rules
set threshold = coalesce(threshold, value, 9)
where threshold is null;

update public.rules
set value = coalesce(value, threshold, 9)
where value is null;

alter table public.rules
  alter column rule_id set not null,
  alter column value set not null;

-- Ensure threshold has NO persistent default so BEFORE INSERT trigger receives NULL when omitted
alter table public.rules
  alter column threshold drop default;

-- Ensure indexes on rules
create unique index if not exists rules_rule_id_uidx on public.rules (rule_id);
create index if not exists idx_rules_threshold on public.rules (threshold);
create index if not exists rules_device_type_idx on public.rules (device_type);

-- Ensure sync_rule_value_and_threshold function and trigger exist
create or replace function public.sync_rule_value_and_threshold()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.value is null then
      new.value := new.threshold;
    end if;
    if new.threshold is null then
      new.threshold := new.value;
    end if;
  elsif new.value is distinct from old.value
        and new.threshold is not distinct from old.threshold then
    new.threshold := new.value;
  elsif new.threshold is distinct from old.threshold
        and new.value is not distinct from old.value then
    new.value := new.threshold;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_rule_value_and_threshold on public.rules;

create trigger sync_rule_value_and_threshold
before insert or update of value, threshold on public.rules
for each row
execute function public.sync_rule_value_and_threshold();

-- 2. Ensure devices table compatibility
create table if not exists public.devices (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid references public.rules(id) on delete cascade,
  x numeric not null,
  y numeric not null,
  room_id uuid,
  created_at timestamptz not null default now()
);

alter table public.devices
  add column if not exists drawing_id uuid,
  add column if not exists room_id uuid,
  add column if not exists type text,
  add column if not exists layer text,
  add column if not exists rule_id uuid;

alter table public.devices
  alter column rule_id drop not null;

create index if not exists idx_devices_drawing_id on public.devices (drawing_id);

-- 3. Ensure drawings unit_scale_m
alter table public.drawings
  add column if not exists unit_scale_m numeric check (unit_scale_m > 0);

-- 4. Re-apply RLS policies on rooms
alter table public.rooms enable row level security;

drop policy if exists "rooms_select_own_or_admin" on public.rooms;
create policy "rooms_select_own_or_admin"
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

drop policy if exists "rooms_insert_own_or_admin" on public.rooms;
create policy "rooms_insert_own_or_admin"
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

drop policy if exists "rooms_update_own_or_admin" on public.rooms;
create policy "rooms_update_own_or_admin"
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

drop policy if exists "rooms_delete_own_or_admin" on public.rooms;
create policy "rooms_delete_own_or_admin"
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

-- 5. Re-apply RLS policies on devices
alter table public.devices enable row level security;

drop policy if exists "devices_select_own_or_admin" on public.devices;
create policy "devices_select_own_or_admin"
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

drop policy if exists "devices_insert_own_or_admin" on public.devices;
create policy "devices_insert_own_or_admin"
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

drop policy if exists "devices_update_own_or_admin" on public.devices;
create policy "devices_update_own_or_admin"
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

drop policy if exists "devices_delete_own_or_admin" on public.devices;
create policy "devices_delete_own_or_admin"
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
