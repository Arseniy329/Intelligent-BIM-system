-- BIM-75: проходи між приміщеннями.
-- Близькі або навіть однакові контури двох приміщень НЕ доводять, що між ними можна
-- пройти: їх може розділяти суцільна стіна. Тому маршрут евакуації між приміщеннями
-- будується лише через прохід — точку на плані (двері або отвір) у координатах креслення.
--   source = 'dxf'    — двері, знайдені під час обробки креслення (шар дверей, крім
--                       дверей, які є евакуаційними виходами);
--   source = 'manual' — прохід, який підтвердив інженер на плані.
-- Повторна обробка заміняє лише проходи з source = 'dxf' (див. replace_dxf_layout);
-- ручні лишаються.

create table if not exists public.passages (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  name text,
  x numeric not null,
  y numeric not null,
  source text not null default 'manual' check (source in ('dxf', 'manual')),
  created_at timestamptz not null default now()
);

create index if not exists idx_passages_drawing_id on public.passages(drawing_id);

alter table public.passages enable row level security;

drop policy if exists "passages_own_or_admin" on public.passages;
create policy "passages_own_or_admin"
on public.passages
for all
using (
  exists (
    select 1
    from public.drawings d
    where d.id = passages.drawing_id
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
    where d.id = passages.drawing_id
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
