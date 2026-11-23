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

-- ── BIM-73: звіт розміщення зберігається разом із результатом ──────────────
do $$
declare
  col_type text;
  col_nullable text;
begin
  select data_type, is_nullable into col_type, col_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'drawings' and column_name = 'placement_report';
  if col_type is distinct from 'jsonb' then
    raise exception 'drawings.placement_report must be jsonb, found %', col_type;
  end if;
  if col_nullable <> 'YES' then
    raise exception 'drawings.placement_report must be nullable (null = no report)';
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
