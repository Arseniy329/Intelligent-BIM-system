-- BIM-73: зони приміщення. Приміщення з перепадом висот стелі ділиться на частини,
-- кожна зі своєю висотою; розміщення сповіщувачів іде окремо по кожній зоні.
-- Зона належить приміщенню і видаляється разом із ним (також при повторній обробці
-- креслення, яка замінює приміщення). Висота NULL = «недостатньо даних».

create table if not exists public.room_zones (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  name text,
  height numeric check (height is null or height > 0),
  area numeric not null default 0,
  polygon jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_room_zones_room_id on public.room_zones(room_id);
create index if not exists idx_room_zones_drawing_id on public.room_zones(drawing_id);

alter table public.room_zones enable row level security;

drop policy if exists "room_zones_own_or_admin" on public.room_zones;
create policy "room_zones_own_or_admin"
on public.room_zones
for all
using (
  exists (
    select 1
    from public.drawings d
    where d.id = room_zones.drawing_id
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
    where d.id = room_zones.drawing_id
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
