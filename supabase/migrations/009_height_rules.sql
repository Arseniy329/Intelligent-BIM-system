-- BIM-73: правила для точкових сповіщувачів залежно від висоти приміщення.
-- Джерело значень: «Таблиця нормативних значень для задач Спринту 4»
-- (BIM-169, Денис, 19.11.2026), розділ 1. Номери пунктів — як у таблиці Дениса.
--
-- Діапазони висот включно по обидва боки; на стику діапазонів (напр. рівно 6,0 м)
-- алгоритм бере суворіше правило (див. select_rule_for_room).
-- Вже існуючі SMOKE_GRID_HEIGHT_3_5 і SMOKE_WALL_CLEARANCE (до 3,5 м, ДСТУ EN 54-14)
-- не змінюються: для висоти до 3,5 м беремо суворіше значення ДСТУ (80 м², конфлікт №1).
--
-- Статуси:
--   verified     — у таблиці Дениса значення має статус «Перевірено»;
--   needs_review — теплові 6,0–9,0 м: у таблиці «Перевірено», але є конфлікт №2
--                  між ДБН В.2.5-56 і ДСТУ EN 54-14 (висота застосування), який
--                  Денис просить фіксувати як «Треба перевірити» (BIM-77).
--
-- Крок і відстань до стіни — у метрах. Площа захисту — у conditions.max_protected_area_m2.

insert into public.rules (
  rule_id, name, device_type, document, clause, conditions,
  threshold, value, value_kind, room_types, min_height_m, max_height_m,
  source_url, status, verification_status
)
values
-- ── Димові: крок сітки та площа захисту ──────────────────────────────────────
('SMOKE_GRID_HEIGHT_3_5_6',
 'Крок сітки димових сповіщувачів, висота 3,5–6,0 м',
 'smoke_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.1',
 '{"max_protected_area_m2": 70}'::jsonb,
 8.5, 8.5, 'max_grid_spacing_m', '{}', 3.5, 6.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('SMOKE_GRID_HEIGHT_6_10',
 'Крок сітки димових сповіщувачів, висота 6,0–10,0 м',
 'smoke_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.1',
 '{"max_protected_area_m2": 65}'::jsonb,
 8.0, 8.0, 'max_grid_spacing_m', '{}', 6.0, 10.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('SMOKE_GRID_HEIGHT_10_12',
 'Крок сітки димових сповіщувачів, висота 10,0–12,0 м',
 'smoke_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.1',
 '{"max_protected_area_m2": 55}'::jsonb,
 7.5, 7.5, 'max_grid_spacing_m', '{}', 10.0, 12.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
-- ── Димові: максимальна відстань до стіни ────────────────────────────────────
('SMOKE_WALL_HEIGHT_3_5_6',
 'Відстань від димового сповіщувача до стіни, висота 3,5–6,0 м',
 'smoke_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.1',
 '{"min_wall_clearance_m": 0.5}'::jsonb,
 4.0, 4.0, 'max_wall_distance_m', '{}', 3.5, 6.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('SMOKE_WALL_HEIGHT_6_10',
 'Відстань від димового сповіщувача до стіни, висота 6,0–10,0 м',
 'smoke_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.1',
 '{"min_wall_clearance_m": 0.5}'::jsonb,
 4.0, 4.0, 'max_wall_distance_m', '{}', 6.0, 10.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('SMOKE_WALL_HEIGHT_10_12',
 'Відстань від димового сповіщувача до стіни, висота 10,0–12,0 м',
 'smoke_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.1',
 '{"min_wall_clearance_m": 0.5}'::jsonb,
 3.5, 3.5, 'max_wall_distance_m', '{}', 10.0, 12.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
-- ── Теплові: крок сітки та площа захисту ─────────────────────────────────────
('HEAT_GRID_HEIGHT_3_5',
 'Крок сітки теплових сповіщувачів, висота до 3,5 м',
 'heat_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.2',
 '{"max_protected_area_m2": 25}'::jsonb,
 5.0, 5.0, 'max_grid_spacing_m', '{}', null, 3.5,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('HEAT_GRID_HEIGHT_3_5_6',
 'Крок сітки теплових сповіщувачів, висота 3,5–6,0 м',
 'heat_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.2',
 '{"max_protected_area_m2": 20}'::jsonb,
 4.5, 4.5, 'max_grid_spacing_m', '{}', 3.5, 6.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('HEAT_GRID_HEIGHT_6_9',
 'Крок сітки теплових сповіщувачів, висота 6,0–9,0 м',
 'heat_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.2',
 '{"max_protected_area_m2": 15, "conflict": "ДСТУ EN 54-14, п. 6.5.2, табл. А.1: до 7,5 м (клас A1) або 6,0 м (інші класи)"}'::jsonb,
 4.0, 4.0, 'max_grid_spacing_m', '{}', 6.0, 9.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'needs_review', 'needs_review'),
-- ── Теплові: максимальна відстань до стіни ───────────────────────────────────
('HEAT_WALL_HEIGHT_3_5',
 'Відстань від теплового сповіщувача до стіни, висота до 3,5 м',
 'heat_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.2',
 '{"min_wall_clearance_m": 0.5}'::jsonb,
 2.5, 2.5, 'max_wall_distance_m', '{}', null, 3.5,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('HEAT_WALL_HEIGHT_3_5_6',
 'Відстань від теплового сповіщувача до стіни, висота 3,5–6,0 м',
 'heat_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.2',
 '{"min_wall_clearance_m": 0.5}'::jsonb,
 2.0, 2.0, 'max_wall_distance_m', '{}', 3.5, 6.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'verified', 'verified'),
('HEAT_WALL_HEIGHT_6_9',
 'Відстань від теплового сповіщувача до стіни, висота 6,0–9,0 м',
 'heat_detector', 'ДБН В.2.5-56:2014', 'Додаток Б, таблиця Б.2',
 '{"min_wall_clearance_m": 0.5}'::jsonb,
 2.0, 2.0, 'max_wall_distance_m', '{}', 6.0, 9.0,
 'https://uas.gov.ua/national-fund-of-regulatory-documents/', 'needs_review', 'needs_review')
on conflict (rule_id) do nothing;
