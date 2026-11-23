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
