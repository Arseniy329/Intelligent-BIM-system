-- BIM-75: правила для ручних пожежних сповіщувачів.
-- Джерело значень: «Таблиця нормативних значень для задач Спринту 4»
-- (BIM-169, Денис, 19.11.2026), розділ 1, рядки «Ручні сповіщувачі (BIM-75)».
-- Номери пунктів — як у таблиці Дениса, не вигадані.
--
-- Максимальна відстань між ручними сповіщувачами вздовж шляхів евакуації —
-- конфлікт №3 між нормами:
--   ДСТУ EN 54-14:2021, п. 6.6      — не більше 30 м;
--   ДБН В.2.5-56:2014, п. 7.2.15    — не більше 50 м всередині будівлі.
-- Обидва значення зберігаються як окремі правила (BIM-77 бачить конфлікт).
-- Розміщення береться за суворішим правилом (30 м): це збігається з підходом
-- BIM-73 для висоти на стику діапазонів і з рекомендацією Дениса.
--
-- value_kind = max_grid_spacing_m («максимальний крок між приладами, м») — той самий
-- вид значення, що й у димових сповіщувачів; тип приладу визначає device_type.
-- Тому ні CHECK-обмеження rules_value_kind_check, ні контракти змінювати не треба.
--
-- «Біля виходів і на шляхах евакуації» (п. 6.6 / п. 7.2.15) числа не має —
-- записано в conditions.place_at.
-- conditions.exit_offset_m — технічний параметр алгоритму (на скільки метрів
-- від виходу всередину приміщення ставити прилад), у таблиці Дениса його немає.
-- Значення 1,0 м — припущення, яке треба підтвердити з Денисом.
-- conditions.mounting_height_m — висота від підлоги (інформаційно, на 2D-плані
-- не використовується).

insert into public.rules (
  rule_id, name, device_type, document, clause, conditions,
  threshold, value, value_kind, room_types, min_height_m, max_height_m,
  source_url, status, verification_status
)
values
('MANUAL_CALL_POINT_SPACING_DSTU',
 'Максимальна відстань між ручними сповіщувачами (ДСТУ EN 54-14)',
 'manual_call_point', 'ДСТУ EN 54-14:2021', 'п. 6.6',
 '{"place_at": ["exits", "evacuation_routes"],
   "exit_offset_m": 1.0,
   "mounting_height_m": {"min": 1.2, "max": 1.5},
   "conflict": "Конфлікт №3 (BIM-169): ДБН В.2.5-56:2014, п. 7.2.15 — до 50 м"}'::jsonb,
 30, 30, 'max_grid_spacing_m', '{}', null, null,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/692', 'verified', 'verified'),
('MANUAL_CALL_POINT_SPACING_DBN',
 'Максимальна відстань між ручними сповіщувачами (ДБН В.2.5-56)',
 'manual_call_point', 'ДБН В.2.5-56:2014', 'п. 7.2.15',
 '{"place_at": ["exits", "evacuation_routes"],
   "exit_offset_m": 1.0,
   "mounting_height_m": {"value": 1.5, "tolerance": 0.1},
   "conflict": "Конфлікт №3 (BIM-169): ДСТУ EN 54-14:2021, п. 6.6 — до 30 м"}'::jsonb,
 50, 50, 'max_grid_spacing_m', '{}', null, null,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/692', 'verified', 'verified')
on conflict (rule_id) do nothing;
