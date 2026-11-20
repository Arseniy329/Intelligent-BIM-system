-- BIM-75: евакуаційні виходи креслення.
-- Вихід — точка на плані (двері) у координатах креслення.
--   source = 'dxf'    — знайдено під час обробки креслення: двері на шарі EXITS
--                       або двері з підписом «Вихід» поруч;
--   source = 'manual' — інженер позначив двері на плані (API для BIM-182).
-- Повторна обробка креслення замінює лише виходи з source = 'dxf';
-- ручні позначки лишаються.
-- Приміщення (room_id) не обов'язкове: при видаленні приміщення вихід залишається.

create table if not exists public.exits (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  name text,
  x numeric not null,
  y numeric not null,
  source text not null default 'manual' check (source in ('dxf', 'manual')),
  created_at timestamptz not null default now()
);

create index if not exists idx_exits_drawing_id on public.exits(drawing_id);
create index if not exists idx_exits_room_id on public.exits(room_id);

alter table public.exits enable row level security;

drop policy if exists "exits_own_or_admin" on public.exits;
create policy "exits_own_or_admin"
on public.exits
for all
using (
  exists (
    select 1
    from public.drawings d
    where d.id = exits.drawing_id
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
    where d.id = exits.drawing_id
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
