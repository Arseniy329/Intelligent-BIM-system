-- Дані, які вже є в БД до оновлення (стан main/dev). Після оновлення
-- survival.sql перевіряє, що вони нікуди не поділися.
insert into auth.users (id, email)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'seed@example.com');

insert into public.drawings (id, owner_id, original_file_name, storage_path, units, status, unit_scale_m)
values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'seed.dxf', 'seed/seed.dxf', 'mm', 'processed', 0.001);

insert into public.rooms (id, drawing_id, name, type, height, area, polygon, source)
values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
        'Seed room', 'office', 3.0, 80,
        '[{"x":0,"y":0},{"x":10000,"y":0},{"x":10000,"y":8000},{"x":0,"y":8000}]'::jsonb, 'auto');

insert into public.devices (id, drawing_id, room_id, type, layer, x, y)
values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'smoke_detector', 'SYS_FIRE_SENSORS', 5000, 4000);
