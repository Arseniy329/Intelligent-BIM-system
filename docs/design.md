# Design System | Intelligent BIM: Fire Safety MVP

**Задача:** BIM-64 
**Файл токенів:** [`tokens.json`](../tokens.json)  

Цей документ визначає візуальні правила вебінтерфейсу MVP і дизайн-контракт для перегляду DXF-креслень, приміщень та пожежних пристроїв. Токени з `tokens.json` є джерелом значень. Колір та форма умовних позначень на плані є **UI-конвенціями**, а не підтвердженими нормативними символами чи висновком про відповідність ДБН/ДСТУ.

## 1. Принципи

1. **План головний.** DXF-креслення займає основну робочу область. Жодна заливка не повинна приховувати стіни, підписи, розмірні лінії чи геометрію.
2. **Статуси зрозумілі без кольору.** Колір доповнюють форма, обводка, підпис або іконка. `Confirmed` не дорівнює нормативному схваленню.
3. **Послідовність.** Назва й значення стану збігаються на полотні, у легенді, tooltip та панелі деталей.
4. **Невипадкові параметри.** Для всіх повторюваних кольорів, розмірів, відступів і станів використовуються токени.
5. **Чіткий зворотний зв'язок.** Завантаження, відсутність даних, помилки й недоступні дії пояснюються текстом.

## 2. Основа дизайн-системи

### 2.1 Кольори

| Призначення | Токен | Значення |
|---|---|---|
| Основна дія / активний елемент | `color.brand.primary` | `#2563EB` |
| Hover основної дії | `color.brand.primaryHover` | `#1D4ED8` |
| Pressed основної дії | `color.brand.primaryPressed` | `#1E40AF` |
| Основний текст | `color.text.primary` | `#0F172A` |
| Допоміжний текст | `color.text.secondary` | `#475569` |
| Фон сторінки | `color.surface.page` | `#F8FAFC` |
| Поверхні карток/панелей | `color.surface.default` | `#FFFFFF` |
| Стандартна межа | `color.border.default` | `#E2E8F0` |
| Фокус | `color.border.focus` | `#2563EB` |

Для системних повідомлень застосовуються `color.semantic.success*`, `warning*`, `error*`, `info*` і `disabled*`. Для бейджів призначені `color.badge.*`. Зелений/жовтий/червоний кольори **системних повідомлень** не можна плутати зі статусом кімнати або типом пристрою без підпису.

### 2.2 Типографіка

Основна сім'я `typography.fontFamily.base`: Inter із системним sans-serif fallback. Для координат і технічних значень дозволено `typography.fontFamily.mono`.

| Стиль `typography.textStyle.*` | Розмір / line-height | Вага | Використання |
|---|---|---:|---|
| `display` | 32 / 40 px | 600 | Великі заголовки, за потреби |
| `headingH1` | 24 / 32 px | 600 | Назва сторінки |
| `headingH2` | 20 / 28 px | 600 | Назва секції |
| `headingH3` | 16 / 24 px | 600 | Назва панелі |
| `bodyLarge` | 16 / 24 px | 400 | Розгорнуте пояснення |
| `body` | 14 / 20 px | 400 | Основний текст |
| `bodyMedium` | 14 / 20 px | 500 | Значення / акцент |
| `label` | 12 / 16 px | 500 | Підпис поля |
| `caption` | 12 / 16 px | 400 | Метадані |
| `numeric` | 13 / 20 px | 500 | Числа / координати |

Статуси мають залишатися читабельними. Довгі назви файлів скорочуються лише за умови доступності повного значення.

### 2.3 Геометрія і відступи

Базовий крок: 4 px. Шкала `spacing`: `1` = 4, `2` = 8, `3` = 12, `4` = 16, `5` = 20, `6` = 24, `8` = 32, `10` = 40, `12` = 48 px. Стандартний контрол `size.controlMd` = 40 px, компактний `size.controlSm` = 32 px, великий `size.controlLg` = 48 px. Рекомендована інтерактивна ціль `size.interactiveTargetMin` = 40 px.

Для компонентів використовуються `radius.sm` = 4, `radius.md` = 8, `radius.lg` = 12, `radius.xl` = 16 px; `radius.full` = 999 px. Межі `borderWidth.default` = 1 px, `borderWidth.strong` / `focus` = 2 px. `shadow.sm/md/lg` застосовуються стримано: насамперед меню, модальні вікна й підняті над кресленням панелі.

## 3. Базові UI-компоненти

| Компонент | Вміст і правила | Токени |
|---|---|---|
| Кнопка | Primary, Secondary, Ghost, Danger; Default, Hover, Pressed, Focus-visible, Disabled, Loading. Завантаження блокує повторний запуск. | `color.button.*`, `component.button.*` |
| Поле / завантаження файлу | Постійний label, допоміжний текст, error, focus, disabled. Для файлу показувати відомі назву, формат, розмір і прогрес. | `color.input.*`, `component.input.*` |
| Таблиця | Loading, Empty, Error, Hover row, Selected row. Hover не імітує вибір, числа вирівнюються послідовно. | `color.table.*`, `component.table.*` |
| Статусний бейдж | Іконка/позначка та зрозумілий текст, не лише колір. | `color.badge.*`, `component.badge.*` |
| Панель плану | Полотно, toolbar, шари, легенда, деталі вибраного об'єкта, стани Empty/Loading/Ready/Error. | `color.planPanel.*`, `component.planPanel.*` |

Не декларувати підтримку DWG чи інших форматів, доки її не підтвердить реалізація. У MVP первинним форматом є DXF.

## 4. DXF DrawingViewer: фон, лінії, підписи

Токени нижче стосуються **відображення в інтерфейсі**, а не перезапису кольорів оригінального DXF.

| Об'єкт | Токен | Колір |
|---|---|---|
| Фон плану | `color.plan.background` | `#F8FAFC` |
| Основні лінії DXF | `color.plan.dxfPrimaryLine` | `#525C66` |
| Допоміжні лінії DXF | `color.plan.dxfSecondaryLine` | `#6B7B90` |
| Підписи й розміри DXF | `color.plan.dxfText` | `#475569` |
| Допоміжна сітка, якщо є | `color.plan.grid` | `#CBD5E1` |

Якщо renderer використовує власні кольори DXF, ці значення не повинні примусово їх заміняти. Пріоритет: читабельність вихідного креслення, збереження товщини ліній і підписів, відсутність накладення суцільних заливок.

**Візуальний порядок від нижнього до верхнього:** DXF base → Room polygons → Device markers → Violation indications → Hover/Selection highlight → Tooltip / floating UI. Це логіка шарів, а не вимога конкретного `z-index`. Якщо можливо, DXF-розміри й критичні підписи варто залишати видимими поверх полігонів.

## 5. Room overlay: стани приміщень

### 5.1 Базові стани

| Room state | Fill | Fill opacity | Stroke | Stroke width |
|---|---|---:|---|---|
| `default` | `color.plan.roomFill` `#E2E8F0` | `opacity.plan.roomDefault` 0.08 | `color.plan.roomStroke` `#64748B` | `borderWidth.roomDefault` 1 px |
| `confirmed` | `color.plan.roomConfirmedFill` `#12B983` | `opacity.plan.roomConfirmed` 0.10 | `color.plan.roomConfirmedStroke` `#0D8E64` | `borderWidth.roomDefault` 1 px |
| `needsReview` | `color.plan.roomNeedsReviewFill` `#F09A20` | `opacity.plan.roomNeedsReview` 0.12 | `color.plan.roomNeedsReviewStroke` `#B45309` | `borderWidth.roomDefault` 1 px |

`confirmed` означає підтвердження в UI, `needsReview` означає потребу перевірки. Це **не нормативні висновки**. Статус треба показувати текстом у tooltip або панелі деталей; візуальні відмінності заливки не можуть бути єдиним індикатором.

### 5.2 Інтерактивні стани

| Стан | Fill opacity | Stroke | Stroke width |
|---|---:|---|---|
| `hover` | `opacity.plan.roomHover` 0.12 | `color.plan.roomHoverStroke` `#2563EB` | `borderWidth.roomHover` 1.5 px |
| `selected` | `opacity.plan.roomSelected` 0.12 | `color.plan.roomSelectedStroke` `#0F172A` | `borderWidth.roomSelected` 2 px |

**Пріоритет стилів:** Selected > Hover > базовий Room state. Hover і Selected змінюють *візуальний стан*, але не редагують реальний статус або DXF-геометрію. Fill бере колір базового стану приміщення, інтерактивний стан змінює лише opacity та обводку. Не застосовувати opacity більше 12% без окремого тесту на щільному кресленні. Якщо заливка закриває підпис, спершу зменшити opacity або локально вимкнути заливку.

## 6. Пристрої та індикатори порушень

### 6.1 Умовні позначення пристроїв

| Тип пристрою | Колір | Форма |
|---|---|---|
| Smoke detector | `color.plan.deviceSmoke` `#2563EB` | Коло |
| Heat detector | `color.plan.deviceHeat` `#B45309` | Трикутник |
| Manual call point | `color.plan.deviceManualCallPoint` `#DC2626` | Квадрат |
| Sounder / notification | `color.plan.deviceSounder` `#15803D` | Ромб |

`color.plan.detector` і `color.plan.notification` зберігаються як **існуючі кольори груп шарів**, а `device*` задають тип конкретного маркера. Для контрасту маркера використовується `color.plan.markerOutline` `#FFFFFF`; обводки `borderWidth.deviceDefault` 1.5 px та `borderWidth.deviceSelected` 2 px. Форми потрібно показувати в легенді; вони не є затвердженими нормативними символами.

### 6.2 Порушення / зауваження

Колір `color.plan.violation` `#DC2626`, прозорість можливої полігональної заливки `opacity.plan.violation` 0.10. Для помітності додавати іконку/короткий текст і, за потреби, пунктирний контур. Не вводити рівні severity, доки вони не визначені продуктовою логікою; `violation` тут лише загальний візуальний стан.

## 7. SVG-маркери: дизайн-правила для BIM-107

Це **специфікація зовнішнього вигляду й поведінки**, не реалізація SVG-файлів або React-компонентів.

- **Розмір у CSS px:** default `size.planMarker` 8 px; hover `size.planMarkerHover` 10 px; selected `size.planMarkerSelected` 12 px. Візуальний маркер може бути компактним, але не його інтерактивна зона.
- **Anchor:** центр маркера (або явно задана точка) відповідає координаті пристрою `x, y` у DXF world coordinates. Зміна стилю чи стану не змінює anchor.
- **Zoom:** координата відображення залежить від viewport transform; розмір glyph залишається в *екранних* CSS px та не збільшується разом із кресленням. Якщо поточний renderer цього не дозволяє, потрібне технічне узгодження.
- **Стани:** default зберігає колір і форму; hover збільшує glyph та показує tooltip; selected дає контрастну обводку; focus-visible має видимий індикатор, disabled або hidden layer не створює прихованої клікабельної цілі.
- **Hit target:** `size.planMarkerHitTarget` 40 × 40 CSS px; на щільному кресленні допустимий компактний `size.planMarkerHitTargetDense` 24 × 24 CSS px за умови відсутності конфлікту цілей. Hit target більший за glyph і має той самий anchor.
- **React/SVG:** стабільний `viewBox`, передбачувані width/height, заповнення/обводка через `currentColor` або CSS custom properties. Для сталого екранного stroke можливий `vector-effect="non-scaling-stroke"`. Інтерактивний маркер має доступне ім'я (`aria-label` або пов'язаний підпис), keyboard focus та альтернативу hover.

## 8. Tooltip, панель шарів і керування планом

### 8.1 Tooltip

Tooltip містить **тип об'єкта / ID / статус**, а додаткову технічну інформацію показує лише якщо вона доступна. Він відкривається при hover та keyboard focus, не виходить за viewport і не замінює панель із критичними зауваженнями.

| Параметр | Токен | Значення |
|---|---|---|
| Фон | `color.planPanel.tooltipBg` | `#0F172A` |
| Текст | `color.planPanel.tooltipText` | `#FFFFFF` |
| Межа | `color.planPanel.tooltipBorder` | `#334155` |
| Max width | `component.planTooltip.maxWidth` | 280 px |
| Padding X / Y | `component.planTooltip.paddingX` / `paddingY` | 12 / 8 px |
| Radius / offset | `component.planTooltip.radius` / `offset` | 8 / 8 px |

### 8.2 Шари та легенда

Шари керують окремо DXF, кімнатами, пристроями та індикаторами порушень, якщо ці шари передбачені реалізацією. Рядок містить назву, позначку типу й toggle. `component.planPanel.layerRowMinHeight` = 36 px, `layerToggleHitTarget` = 40 px; висота рядка може збільшуватися для цілі. Hover рядка: `color.planPanel.layerRowHoverBg`, вибір: `color.planPanel.layerRowSelectedBg`.

У стані Hidden не відображати об'єкти шару й їхні невидимі hit areas. `opacity.plan.layerHidden` 0.50 застосовувати до декоративної позначки шару, **не до тексту назви**. Для читабельного тексту використовується `color.planPanel.layerHiddenText`. У легенді форма, назва та колір мають відповідати полотну.

### 8.3 Toolbar

Кнопки Zoom in/out, Fit view, Pan та інші контролі з'являються лише якщо функції підтримуються. Hit target `component.planPanel.toolbarControlHitTarget` = 40 px. Усі елементи мають hover, focus-visible, disabled (за потреби) та підказку з назвою дії. Наявність кнопки в дизайн-специфікації не означає реалізацію функції в BIM-64.

## 9. Доступність і контроль читабельності

- **Не лише колір:** статус кімнати та тип пристрою підкріплюються текстом/формою/контуром.
- **Keyboard access:** інтерактивні контролі та маркери мають видимий `focus-visible`; критичні деталі доступні без hover.
- **WCAG 2.2 AA:** орієнтир 4.5:1 для звичайного UI-тексту, 3:1 для відповідних нетекстових компонентів, де застосовно.
- **DXF-підкладка:** перевіряти на реальних світлих і щільних кресленнях. Читабельність на порожньому фоні не гарантує читабельності поверх кольорових DXF-ліній.
- **Контроль:** окремо перевірити DXF-підписи під оверлеями, room hover/selected, маркери пристроїв, violation, tooltip і legend. За конфлікту краще додати контрастний контур/halo, ніж посилювати напівпрозору заливку.

## 10. Передача токенів у CSS variables та Tailwind v4

Фактичне розміщення: `tokens.json` у **корені репозиторію**, `docs/design.md` у **docs/**. Поточний `apps/web/app/globals.css` починається з `@import "tailwindcss";`, а web-пакет використовує Tailwind CSS v4. У межах BIM-64 глобальні стилі та компоненти не редагуються.

1. **Source of truth:** усі кольори, розміри та opacity задаються в JSON. Не копіювати hex у кілька React-компонентів.
2. **Назви CSS variables:** префікс `--bim-`; шлях токена перетворюється на kebab-case: `color.plan.dxfPrimaryLine` → `--bim-color-plan-dxf-primary-line`; `opacity.plan.roomHover` → `--bim-opacity-plan-room-hover`.
3. **Tailwind v4:** frontend може експортувати токени як CSS custom properties та зіставити потрібні кольори з utilities через `@theme inline`, наприклад:

   ```css
   /* Приклад схеми інтеграції для frontend, не зміна globals.css у BIM-64. */
   :root { --bim-color-plan-detector: #2563EB; }
   @theme inline { --color-plan-detector: var(--bim-color-plan-detector); }
   ```

4. **Canvas / SVG:** використовувати `var(--bim-color-plan-detector)` або передавати значення токенів до renderer. Opacity 0.08 / 0.10 / 0.12 є числами, їх потрібно передавати відповідним параметром API або як CSS alpha, не трактувати як колір.
5. **Синхронізація:** при зміні значень одночасно змінювати JSON, документацію та CSS-mapping. Tailwind utilities й pipeline експорту визначає власник frontend.

## 11. Питання для технічного узгодження

Вони **не є додатковими задачами BIM-64** та не блокують використання файлів як дизайн-специфікації:

| Для кого | Підтвердити |
|---|---|
| Михайло / frontend | Чи можна стилізувати DXF-лінії/текст без зміни вихідного файлу; розмір SVG у screen px під zoom; обмеження 40 px hit targets на щільному плані; правила hide/select для шарів; mapping токенів із Tailwind v4. |
| Product / інженер | Семантику `confirmed`/`needsReview`; форму маркерів як конвенцію UI; потребу в рівнях severity; підтримувані формати (DWG не припускається автоматично). |
| UI review після інтеграції | Перевірку контрасту та накладання на реальних DXF, зокрема підписи, room fills і маркери; звірення з погодженим мудбордом. |

**Межі BIM-64:** документація та `tokens.json`. Не входять: реалізація DrawingViewer (BIM-59), room/device overlays (BIM-60), виготовлення SVG/React-компонентів (BIM-107), зміни CSS/JS, нормативні розрахунки та експорт DXF.
