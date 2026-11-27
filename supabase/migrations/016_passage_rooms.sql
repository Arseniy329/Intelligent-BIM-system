-- BIM-75: прохід належить КОНКРЕТНІЙ парі приміщень.
-- Раніше прохід з'єднував усі приміщення, контури яких були поруч із точкою: двері
-- між коридорами A і B «підтверджували» шлях і до коридору C за суцільною стіною.
-- Тепер прохід зберігає два приміщення, які він з'єднує (room_a_id, room_b_id), і
-- маршрут будується лише між ними. Прохід без пари (NULL) не підтверджує нічого:
-- він або неоднозначний (з DXF не можна визначити дві сторони), або застарілий.
--
-- Застарілість визначається самою схемою. Приміщення при кожній обробці креслення
-- створюються з новими id; зв'язок ON DELETE SET NULL обнуляє пару в усіх проходах,
-- що стосувалися старих приміщень. Тому, якщо після повторного розбору запис проходів
-- не вдався, старі проходи лишаються як дані, але не підтверджують маршрути для
-- нових контурів.
--
-- Існуючі проходи (створені до цієї міграції) пари не мають: вони не враховуються,
-- доки креслення не оброблено заново (dxf) або прохід не підтверджено вручну (manual).

alter table public.passages
  add column if not exists room_a_id uuid references public.rooms(id) on delete set null,
  add column if not exists room_b_id uuid references public.rooms(id) on delete set null;

alter table public.passages
  drop constraint if exists passages_distinct_rooms;
alter table public.passages
  add constraint passages_distinct_rooms check (room_a_id is null or room_a_id <> room_b_id);

create index if not exists idx_passages_room_a_id on public.passages(room_a_id);
create index if not exists idx_passages_room_b_id on public.passages(room_b_id);

-- replace_dxf_layout тепер записує пару приміщень і заново прив'язує ручні проходи
-- до нових приміщень. Стара версія (4 аргументи) видаляється, щоб не лишилось двох
-- перевантажень з різною поведінкою.
--
-- p_passages: [{"id"?, "name"?, "x", "y", "room_a_id"?, "room_b_id"?}, ...]
-- p_manual_passage_rooms: [{"id", "room_a_id", "room_b_id"}, ...]  (обидва можуть бути null)
drop function if exists public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb);

create or replace function public.replace_dxf_layout(
  p_drawing_id uuid,
  p_exits jsonb default '[]'::jsonb,
  p_passages jsonb default '[]'::jsonb,
  p_manual_exit_rooms jsonb default '[]'::jsonb,
  p_manual_passage_rooms jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_exits integer;
  v_passages integer;
begin
  if p_drawing_id is null then
    raise exception 'p_drawing_id is required';
  end if;
  if jsonb_typeof(coalesce(p_exits, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_passages, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_manual_exit_rooms, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_manual_passage_rooms, '[]'::jsonb)) <> 'array' then
    raise exception 'all p_* arguments must be JSON arrays';
  end if;

  delete from public.exits where drawing_id = p_drawing_id and source = 'dxf';
  delete from public.passages where drawing_id = p_drawing_id and source = 'dxf';

  insert into public.exits (id, drawing_id, room_id, name, x, y, source)
  select
    coalesce((item ->> 'id')::uuid, gen_random_uuid()),
    p_drawing_id,
    nullif(item ->> 'room_id', '')::uuid,
    item ->> 'name',
    (item ->> 'x')::numeric,
    (item ->> 'y')::numeric,
    'dxf'
  from jsonb_array_elements(coalesce(p_exits, '[]'::jsonb)) as item;
  get diagnostics v_exits = row_count;

  insert into public.passages (id, drawing_id, name, x, y, source, room_a_id, room_b_id)
  select
    coalesce((item ->> 'id')::uuid, gen_random_uuid()),
    p_drawing_id,
    item ->> 'name',
    (item ->> 'x')::numeric,
    (item ->> 'y')::numeric,
    'dxf',
    nullif(item ->> 'room_a_id', '')::uuid,
    nullif(item ->> 'room_b_id', '')::uuid
  from jsonb_array_elements(coalesce(p_passages, '[]'::jsonb)) as item;
  get diagnostics v_passages = row_count;

  update public.exits as e
  set room_id = nullif(link ->> 'room_id', '')::uuid
  from jsonb_array_elements(coalesce(p_manual_exit_rooms, '[]'::jsonb)) as link
  where e.id = (link ->> 'id')::uuid
    and e.drawing_id = p_drawing_id
    and e.source = 'manual';

  update public.passages as p
  set room_a_id = nullif(link ->> 'room_a_id', '')::uuid,
      room_b_id = nullif(link ->> 'room_b_id', '')::uuid
  from jsonb_array_elements(coalesce(p_manual_passage_rooms, '[]'::jsonb)) as link
  where p.id = (link ->> 'id')::uuid
    and p.drawing_id = p_drawing_id
    and p.source = 'manual';

  return jsonb_build_object('exits', v_exits, 'passages', v_passages);
end;
$$;

revoke all on function public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
