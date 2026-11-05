alter table public.rules
  
  add column if not exists rule_id text,
  add column if not exists device_type text,
  add column if not exists value numeric,
  add column if not exists value_kind text,
  add column if not exists room_types text[] not null default '{}',
  add column if not exists min_height_m numeric,
  add column if not exists max_height_m numeric,
  add column if not exists source_url text,
  add column if not exists verification_status text not null default 'needs_review',
  add column if not exists status text not null default 'needs_review';

-- Для старих записів це технічні коди, не номери пунктів нормативів.
update public.rules
set rule_id = 'LEGACY-' || id::text
where rule_id is null;

update public.rules
set value = threshold
where value is null;

alter table public.rules
  alter column rule_id set not null,
  alter column value set not null;

create unique index if not exists rules_rule_id_uidx
  on public.rules (rule_id);

create index if not exists rules_device_type_idx
  on public.rules (device_type);

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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rules_device_type_check'
  ) then
    alter table public.rules
      add constraint rules_device_type_check
      check (
        device_type is null
        or device_type in (
          'smoke_detector',
          'heat_detector',
          'sounder',
          'manual_call_point'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rules_verification_status_check'
  ) then
    alter table public.rules
      add constraint rules_verification_status_check
      check (verification_status in ('verified', 'needs_review'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rules_value_kind_check'
  ) then
    alter table public.rules
      add constraint rules_value_kind_check
      check (
        value_kind is null
        or value_kind in (
          'max_grid_spacing_m',
          'max_protected_area_m2',
          'max_wall_distance_m',
          'min_wall_clearance_m',
          'min_sound_level_dba'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rules_positive_value_check'
  ) then
    alter table public.rules
      add constraint rules_positive_value_check check (value > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rules_height_range_check'
  ) then
    alter table public.rules
      add constraint rules_height_range_check
      check (
        min_height_m is null
        or max_height_m is null
        or min_height_m <= max_height_m
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rules_verified_source_check'
  ) then
    alter table public.rules
      add constraint rules_verified_source_check
      check (
        verification_status <> 'verified'
        or (
          nullif(trim(clause), '') is not null
          and nullif(trim(source_url), '') is not null
        )
      );
  end if;
end $$;

-- Дані з наданого скриншота. Значення sounder зберігаються як dBA,
-- а не як відстань для розміщення приладів.
insert into public.rules (
  rule_id,
  name,
  device_type,
  document,
  clause,
  conditions,
  threshold,
  value,
  value_kind,
  room_types,
  max_height_m,
  source_url,
  status,
  verification_status
)
values
(
  'SMOKE_GRID_HEIGHT_3_5',
  'Крок сітки та площа захисту димових сповіщувачів',
  'smoke_detector',
  'ДСТУ EN 54-14:2021',
  '6.5.2, таблиця A.1',
  '{"max_protected_area_m2": 80}'::jsonb,
  9,
  9,
  'max_grid_spacing_m',
  '{}',
  3.5,
  'https://uas.gov.ua/national-fund-of-regulatory-documents/',
  'verified',
  'verified'
),
(
  'SMOKE_WALL_CLEARANCE',
  'Відстань від сповіщувача до стіни',
  'smoke_detector',
  'ДСТУ EN 54-14:2021',
  '6.5.2',
  '{"min_wall_clearance_m": 0.5}'::jsonb,
  4.5,
  4.5,
  'max_wall_distance_m',
  '{}',
  3.5,
  'https://uas.gov.ua/national-fund-of-regulatory-documents/',
  'verified',
  'verified'
),
(
  'SOUNDER_GENERAL_LEVEL',
  'Загальні вимоги до рівня звуку оповіщувачів',
  'sounder',
  'ДСТУ EN 54-14:2021',
  '6.7.2',
  '{"min_above_ambient_dba": 5, "proposed_max_direct_visibility_radius_m": 15}'::jsonb,
  65,
  65,
  'min_sound_level_dba',
  '{}',
  null,
  'https://uas.gov.ua/national-fund-of-regulatory-documents/',
  'needs_review',
  'needs_review'
),
(
  'SOUNDER_SLEEPING_ROOM_LEVEL',
  'Вимоги до оповіщувачів у спальних приміщеннях',
  'sounder',
  'ДСТУ EN 54-14:2021',
  '6.7.2',
  '{"doors_closed": true}'::jsonb,
  75,
  75,
  'min_sound_level_dba',
  array['sleeping_room'],
  null,
  'https://uas.gov.ua/national-fund-of-regulatory-documents/',
  'verified',
  'verified'
)
on conflict (rule_id) do nothing;