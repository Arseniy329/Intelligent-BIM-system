-- BIM-73: звіт останнього кроку розміщення зберігається разом із результатом.
-- `status: processed` каже лише, що крок завершився. Які приміщення чи зони
-- пропущено і чому (placement_status, skipped[], попередження кроку), раніше було
-- лише у відповіді POST /place. Після перезавантаження сторінки чи відкриття
-- посилання іншою людиною попередження зникали, хоча результат лишався.
-- Тепер звіт пишеться в тому самому UPDATE, що й статус, і повертається в
-- GET /drawings/{id}. Повторна обробка креслення (POST /process) його скидає:
-- приміщення створюються заново, старий звіт до них не належить.
--
-- Форма значення збігається з відповіддю POST /place:
--   {"placement_status": "complete|partial|insufficient_data",
--    "device_count": N,
--    "skipped": [{"room_id", "zone_id", "name", "zone_name", "scope", "reason"}]}
-- Колонка nullable: null — звіту немає (креслення ще не розміщували).

alter table public.drawings
  add column if not exists placement_report jsonb;

comment on column public.drawings.placement_report is
  'Звіт останнього POST /place (placement_status, device_count, skipped, ...); null до розміщення і після повторної обробки.';
