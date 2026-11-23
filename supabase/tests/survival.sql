-- Дані з seed_before_upgrade.sql мають пережити оновлення.
do $$
begin
  if (select count(*) from public.drawings where id = 'aaaaaaaa-0000-0000-0000-0000000000d1') <> 1
     or (select count(*) from public.rooms where id = 'aaaaaaaa-0000-0000-0000-0000000000a1') <> 1
     or (select count(*) from public.devices where id = 'aaaaaaaa-0000-0000-0000-0000000000e1') <> 1
  then
    raise exception 'seed data did not survive the upgrade';
  end if;
end
$$;

-- Креслення, розміщене до оновлення, не має звіту; звіт можна записати й скинути.
do $$
begin
  if (select placement_report from public.drawings where id = 'aaaaaaaa-0000-0000-0000-0000000000d1') is not null then
    raise exception 'a drawing placed before the upgrade must have no placement_report';
  end if;
  update public.drawings
  set placement_report = '{"placement_status":"partial","device_count":1,"skipped":[{"scope":"remainder","reason":"x"}]}'::jsonb
  where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
  if (select placement_report #>> '{skipped,0,scope}' from public.drawings
      where id = 'aaaaaaaa-0000-0000-0000-0000000000d1') <> 'remainder' then
    raise exception 'placement_report must round-trip through jsonb';
  end if;
  update public.drawings set placement_report = null where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
end
$$;
