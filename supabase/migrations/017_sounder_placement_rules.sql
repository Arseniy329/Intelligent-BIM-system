-- BIM-76: правила РОЗМІЩЕННЯ оповіщувачів (sounder) у таблиці rules.
--
-- У каталозі вже є вимоги до РІВНЯ ЗВУКУ оповіщувачів (міграція 005:
-- SOUNDER_GENERAL_LEVEL 65 дБА, SOUNDER_SLEEPING_ROOM_LEVEL 75 дБА) з
-- value_kind = min_sound_level_dba. Їх алгоритм розміщення застосувати не може:
-- це рівень звуку, а не відстань між приладами. Розрахунок дБА в цьому спринті
-- не роблять (BIM-76), тож для розміщення потрібне окреме правило-відстань.
--
-- Нижче — правила з value_kind = max_grid_spacing_m (той самий вид значення, що й
-- у димових сповіщувачів і ручних сповіщувачів), тому ні CHECK-обмеження, ні
-- контракти міняти не треба; тип приладу задає device_type = 'sounder'.
--
-- ВАЖЛИВО: крок у метрах — ПОПЕРЕДНІЙ, переведений з вимоги до рівня звуку, і має
-- статус «треба перевірити» (needs_review), як вимагає критерій приймання BIM-76.
-- Остаточні числа — зі звірки Дениса (BIM-124 / BIM-169). Основа переведення:
-- conditions.proposed_max_direct_visibility_radius_m = 15 із SOUNDER_GENERAL_LEVEL.
-- Для спальних приміщень (двері зачинені, 75 дБА) крок суворіший. Значення — ДАНІ:
-- їх можна змінити в таблиці rules без зміни коду (критерій приймання №4).

insert into public.rules (
  rule_id, name, device_type, document, clause, conditions,
  threshold, value, value_kind, room_types, min_height_m, max_height_m,
  source_url, status, verification_status
)
values
('SOUNDER_PLACEMENT_GENERAL',
 'Крок розміщення оповіщувачів (попередньо, з вимоги до рівня звуку)',
 'sounder', 'ДСТУ EN 54-14:2021', '6.7.2',
 '{"derived_from_rule_id": "SOUNDER_GENERAL_LEVEL",
   "basis": "proposed_max_direct_visibility_radius_m",
   "proposed_max_direct_visibility_radius_m": 15,
   "needs_review_note": "Переведення рівня звуку (дБА) у крок розміщення не підтверджено: BIM-124 / BIM-169"}'::jsonb,
 15, 15, 'max_grid_spacing_m', '{}', null, null,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'needs_review', 'needs_review'),
('SOUNDER_PLACEMENT_SLEEPING_ROOM',
 'Крок розміщення оповіщувачів у спальних приміщеннях (попередньо)',
 'sounder', 'ДСТУ EN 54-14:2021', '6.7.2',
 '{"derived_from_rule_id": "SOUNDER_SLEEPING_ROOM_LEVEL",
   "doors_closed": true,
   "needs_review_note": "Суворіший крок для спалень (75 дБА, двері зачинені); переведення з дБА не підтверджено: BIM-124 / BIM-169"}'::jsonb,
 10, 10, 'max_grid_spacing_m', array['sleeping_room'], null, null,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'needs_review', 'needs_review')
on conflict (rule_id) do nothing;
