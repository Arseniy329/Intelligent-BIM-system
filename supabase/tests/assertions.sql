-- Перевірки стану схеми після застосування всіх міграцій гілки.
-- Кожна перевірка падає через raise exception; усі зміни даних відкочуються.

-- ── BIM-73: правила за висотою ──────────────────────────────────────────────
do $$
declare
  n int;
begin
  select count(*) into n from public.rules
  where rule_id in (
    'SMOKE_GRID_HEIGHT_3_5_6', 'SMOKE_GRID_HEIGHT_6_10', 'SMOKE_GRID_HEIGHT_10_12',
    'SMOKE_WALL_HEIGHT_3_5_6', 'SMOKE_WALL_HEIGHT_6_10', 'SMOKE_WALL_HEIGHT_10_12',
    'HEAT_GRID_HEIGHT_3_5', 'HEAT_GRID_HEIGHT_3_5_6', 'HEAT_GRID_HEIGHT_6_9',
    'HEAT_WALL_HEIGHT_3_5', 'HEAT_WALL_HEIGHT_3_5_6', 'HEAT_WALL_HEIGHT_6_9');
  if n <> 12 then
    raise exception 'expected 12 height rules, found %', n;
  end if;

  select count(*) into n from public.rules
  where rule_id in ('HEAT_GRID_HEIGHT_6_9', 'HEAT_WALL_HEIGHT_6_9')
    and verification_status = 'needs_review';
  if n <> 2 then
    raise exception 'heat 6-9 m rules must stay needs_review, found %', n;
  end if;

  select count(*) into n from (
    select rule_id from public.rules group by rule_id having count(*) > 1
  ) duplicated;
  if n <> 0 then
    raise exception 'rule_id must be unique';
  end if;
end
$$;

-- ── BIM-73: room_zones і RLS ────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.room_zones') is null then
    raise exception 'public.room_zones is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.room_zones'::regclass) then
    raise exception 'RLS must be enabled on public.room_zones';
  end if;
end
$$;

begin;
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('11111111-0000-0000-0000-00000000000b', 'stranger@example.com');
insert into public.drawings (id, owner_id, original_file_name, storage_path, units)
values ('11111111-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-00000000000a',
        'a.dxf', 'assert/a.dxf', 'mm');
insert into public.rooms (id, drawing_id, name, polygon)
values ('11111111-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000d1',
        'Hall', '[]'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-00000000000a', true);
insert into public.room_zones (room_id, drawing_id, name, height, area, polygon)
values ('11111111-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000d1',
        'Zone', 3.0, 40, '[]'::jsonb);
do $$
begin
  if (select count(*) from public.room_zones) <> 1 then
    raise exception 'owner must see own zone';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-00000000000b', true);
do $$
declare
  rejected boolean := false;
begin
  if (select count(*) from public.room_zones) <> 0 then
    raise exception 'zone of another user must be invisible';
  end if;
  begin
    insert into public.room_zones (room_id, drawing_id, name, height, area, polygon)
    values ('11111111-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000d1',
            'Foreign', 3.0, 40, '[]'::jsonb);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'RLS must reject a zone in a foreign drawing';
  end if;
end
$$;

-- Зона видаляється разом із приміщенням (каскад).
reset role;
delete from public.rooms where id = '11111111-0000-0000-0000-0000000000a1';
do $$
begin
  if (select count(*) from public.room_zones) <> 0 then
    raise exception 'zones must be deleted together with their room';
  end if;
end
$$;
rollback;

-- ── BIM-75: правила ручних сповіщувачів ─────────────────────────────────────
do $$
declare
  n integer;
begin
  select count(*) into n from public.rules
  where rule_id in ('MANUAL_CALL_POINT_SPACING_DSTU', 'MANUAL_CALL_POINT_SPACING_DBN')
    and device_type = 'manual_call_point'
    and verification_status = 'verified';
  if n <> 2 then
    raise exception 'expected 2 verified manual call point rules, found %', n;
  end if;
  if (select value from public.rules where rule_id = 'MANUAL_CALL_POINT_SPACING_DSTU') <> 30
     or (select value from public.rules where rule_id = 'MANUAL_CALL_POINT_SPACING_DBN') <> 50 then
    raise exception 'manual call point spacing must be 30 m (DSTU) and 50 m (DBN)';
  end if;
end
$$;

-- ── BIM-75: exits, passages, RLS ────────────────────────────────────────────
do $$
begin
  if to_regclass('public.exits') is null or to_regclass('public.passages') is null then
    raise exception 'public.exits and public.passages must exist';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.exits'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.passages'::regclass) then
    raise exception 'RLS must be enabled on exits and passages';
  end if;
  if has_function_privilege('anon', 'public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'anon must not execute replace_dxf_layout';
  end if;
  if not has_function_privilege('authenticated', 'public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.replace_dxf_layout(uuid, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'authenticated and service_role must execute replace_dxf_layout';
  end if;
end
$$;

begin;
insert into auth.users (id, email) values
  ('22222222-0000-0000-0000-00000000000a', 'owner2@example.com'),
  ('22222222-0000-0000-0000-00000000000b', 'stranger2@example.com');
insert into public.drawings (id, owner_id, original_file_name, storage_path, units)
values ('22222222-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-00000000000a',
        'b.dxf', 'assert/b.dxf', 'mm');
insert into public.rooms (id, drawing_id, name, polygon)
values ('22222222-0000-0000-0000-0000000000a1', '22222222-0000-0000-0000-0000000000d1',
        'Corridor', '[]'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-00000000000a', true);
insert into public.exits (drawing_id, x, y, source)
values ('22222222-0000-0000-0000-0000000000d1', 0, 0, 'manual');
insert into public.passages (drawing_id, x, y, source)
values ('22222222-0000-0000-0000-0000000000d1', 5, 5, 'manual');

select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-00000000000b', true);
do $$
declare
  rejected boolean := false;
begin
  if (select count(*) from public.exits) <> 0 or (select count(*) from public.passages) <> 0 then
    raise exception 'exits/passages of another user must be invisible';
  end if;
  begin
    insert into public.passages (drawing_id, x, y)
    values ('22222222-0000-0000-0000-0000000000d1', 1, 1);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'RLS must reject a passage in a foreign drawing';
  end if;
end
$$;
rollback;

-- ── BIM-75: replace_dxf_layout замінює все або нічого ───────────────────────
begin;
insert into auth.users (id, email)
values ('33333333-0000-0000-0000-00000000000a', 'owner3@example.com');
insert into public.drawings (id, owner_id, original_file_name, storage_path, units)
values ('33333333-0000-0000-0000-0000000000d1', '33333333-0000-0000-0000-00000000000a',
        'c.dxf', 'assert/c.dxf', 'mm');
insert into public.rooms (id, drawing_id, name, polygon)
values ('33333333-0000-0000-0000-0000000000a1', '33333333-0000-0000-0000-0000000000d1',
        'Hall', '[]'::jsonb);
insert into public.exits (id, drawing_id, name, x, y, source) values
  ('33333333-0000-0000-0000-0000000000e1', '33333333-0000-0000-0000-0000000000d1', 'old dxf 1', 1, 1, 'dxf'),
  ('33333333-0000-0000-0000-0000000000e2', '33333333-0000-0000-0000-0000000000d1', 'old dxf 2', 2, 2, 'dxf'),
  ('33333333-0000-0000-0000-0000000000e3', '33333333-0000-0000-0000-0000000000d1', 'manual', 3, 3, 'manual');
insert into public.passages (id, drawing_id, x, y, source) values
  ('33333333-0000-0000-0000-0000000000f1', '33333333-0000-0000-0000-0000000000d1', 1, 1, 'dxf'),
  ('33333333-0000-0000-0000-0000000000f2', '33333333-0000-0000-0000-0000000000d1', 2, 2, 'manual');

do $$
declare
  result jsonb;
  failed boolean := false;
begin
  -- Успішна заміна: dxf-виходи й dxf-проходи замінено, ручні лишилися,
  -- room_id ручного виходу оновлено.
  result := public.replace_dxf_layout(
    '33333333-0000-0000-0000-0000000000d1',
    '[{"name": "new A", "x": 10, "y": 10, "room_id": "33333333-0000-0000-0000-0000000000a1"},
      {"name": "new B", "x": 20, "y": 20}]'::jsonb,
    '[{"x": 15, "y": 15}]'::jsonb,
    '[{"id": "33333333-0000-0000-0000-0000000000e3", "room_id": "33333333-0000-0000-0000-0000000000a1"}]'::jsonb);
  if result <> '{"exits": 2, "passages": 1}'::jsonb then
    raise exception 'unexpected result %', result;
  end if;
  if (select count(*) from public.exits where source = 'dxf') <> 2
     or (select count(*) from public.exits where name like 'old dxf%') <> 0
     or (select count(*) from public.exits where source = 'manual') <> 1
     or (select room_id from public.exits where id = '33333333-0000-0000-0000-0000000000e3')
        is distinct from '33333333-0000-0000-0000-0000000000a1'::uuid
     or (select count(*) from public.passages where source = 'dxf') <> 1
     or (select count(*) from public.passages where source = 'manual') <> 1 then
    raise exception 'replace_dxf_layout did not replace the DXF layout as expected';
  end if;

  -- Збій посередині (приміщення не існує -> порушення зовнішнього ключа): нічого
  -- не змінилося, попередній набір на місці.
  begin
    perform public.replace_dxf_layout(
      '33333333-0000-0000-0000-0000000000d1',
      '[{"name": "must not appear", "x": 99, "y": 99, "room_id": "99999999-9999-9999-9999-999999999999"}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb);
  exception when foreign_key_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'a broken write must fail';
  end if;
  if (select count(*) from public.exits where name = 'must not appear') <> 0
     or (select count(*) from public.exits where name in ('new A', 'new B')) <> 2
     or (select count(*) from public.passages where source = 'dxf') <> 1 then
    raise exception 'failed replace_dxf_layout must keep the previous exits and passages';
  end if;
end
$$;
rollback;
