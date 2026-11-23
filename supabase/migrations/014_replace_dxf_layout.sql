-- BIM-75: атомарна заміна виходів і проходів, знайдених у DXF.
-- Раніше API видаляло старі виходи й вставляло нові двома окремими запитами:
-- збій між ними стирав раніше знайдені виходи. Функція виконується в одній
-- транзакції: або замінено все, або (при будь-якій помилці) лишається попередній
-- набір без змін. Виходи й проходи з source = 'manual' не чіпаються; змінюється лише
-- room_id ручних виходів, бо приміщення при обробці створюються заново.
--
-- p_exits, p_passages: [{"id"?, "room_id"?, "name"?, "x", "y"}, ...]
-- p_manual_exit_rooms: [{"id", "room_id"}, ...]  (room_id може бути null)
-- Повертає {"exits": N, "passages": M} — скільки записано.

create or replace function public.replace_dxf_layout(
  p_drawing_id uuid,
  p_exits jsonb default '[]'::jsonb,
  p_passages jsonb default '[]'::jsonb,
  p_manual_exit_rooms jsonb default '[]'::jsonb
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
     or jsonb_typeof(coalesce(p_manual_exit_rooms, '[]'::jsonb)) <> 'array' then
    raise exception 'p_exits, p_passages and p_manual_exit_rooms must be JSON arrays';
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

  insert into public.passages (id, drawing_id, name, x, y, source)
  select
    coalesce((item ->> 'id')::uuid, gen_random_uuid()),
    p_drawing_id,
    item ->> 'name',
    (item ->> 'x')::numeric,
    (item ->> 'y')::numeric,
    'dxf'
  from jsonb_array_elements(coalesce(p_passages, '[]'::jsonb)) as item;
  get diagnostics v_passages = row_count;

  update public.exits as e
  set room_id = nullif(link ->> 'room_id', '')::uuid
  from jsonb_array_elements(coalesce(p_manual_exit_rooms, '[]'::jsonb)) as link
  where e.id = (link ->> 'id')::uuid
    and e.drawing_id = p_drawing_id
    and e.source = 'manual';

  return jsonb_build_object('exits', v_exits, 'passages', v_passages);
end;
$$;

revoke all on function public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;
