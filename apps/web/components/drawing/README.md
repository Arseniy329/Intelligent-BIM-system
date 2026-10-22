# DrawingViewer · BIM-59

Актуально на 22.10.2026, гілка `feature/BIM-59`. Це локальний frontend-стенд
`/drawing-preview`; інтеграція з Backend і приймання на хостингу ще не завершені.

## Поточний стан

| Статус | Обсяг |
| --- | --- |
| Реалізовано | DrawingViewer, відкриття DXF, WebGL, pan / zoom / fit, loading/error/retry, TEXT/MTEXT, Drag & Drop, cleanup object URL |
| Реалізовано для майбутньої BIM-60 | Адаптер камери, WCS ↔ CSS pixels, viewport subscriptions; самі оверлеї BIM-60 не реалізовані |
| Перевірено автоматично | Кореневі lint, typecheck, 36 тестів (29 frontend + 7 contracts), production build |
| Перевірено локально у production headless Chrome | Українські підписи, апострофи, zoom/fit; 18 перевірок UI, включно із синтетичними DragEvents та file input |
| Підтверджено користувачем раніше | Геометрія складного DXF, плавні криві, pan і zoom без помітних зависань після завантаження |
| Потребує ручного приймання | Нативний drag із Провідника Windows, колесо/pan/resize у звичайному браузері; три тестові DXF на хостингу |
| Залежить від Backend | Погодження контракту з Дарією, FastAPI, авторизований GET /drawings/{id}, отримання оригінального DXF / read URL |
| Відкладено | Web Worker, оптимізація SPLINE, повторне використання renderer та кешування — лише за потреби й окремим погодженням |

BIM-63 і публікація сайту до цього проходу не входять.

## Запуск і перевірки

Із кореня репозиторію у PowerShell:

~~~powershell
npm.cmd run build
npm.cmd run start
~~~

Відкрийте **http://localhost:3000/drawing-preview**. Кореневий маршрут `/`
наразі повертає порожню сторінку. Для розробки: `npm.cmd run dev`.

Файл відкривається у браузері через object URL і не надсилається на сервер.
Основні fixtures: `apps/api/tests/fixtures/test_drawing_dxf/`;
український синтетичний fixture: `apps/web/tests/fixtures/dxf/04_ukrainian_text.dxf`.

~~~powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
~~~

Усі чотири команди успішно виконані після відновлення npm workspaces.
Тести contracts також проходять; генерація контрактів у фінальному проході
не запускалася, оскільки потребує окремого дозволу. Node-тести геометрії
не замінюють браузерне або хостингове приймання.

## Межі компонентів і координати

- `drawing-viewer.tsx`: Client Component, `next/dynamic` із `ssr: false`,
  retry та оформлення через кореневий `tokens.json`.
- `drawing-canvas.tsx`: lifecycle адаптера, loading/ready/error, WebGL context
  loss, вимірювання часу й cleanup.
- `drawing-preview.tsx`: input, Drag & Drop, валідація та object URL.
- `lib/drawing/viewer-adapter.ts`: межа `dxf-viewer@1.0.50`, камера,
  fit/zoom/resize, WCS ↔ CSS pixels і viewport subscriptions.
- `lib/drawing/load-timings.ts`: інтервали за публічним progress API.

`DrawingViewer` приймає `url` (локальний object URL або вже отриманий signed
read URL), необов'язкові `fileName` і `onReady`. Компонент не отримує
авторизований URL самостійно і не припускає конкретного поля відповіді API.

`onReady(controller)` надає контролер; `onReady(null)` завершує його
використання. `worldToScreen` / `screenToWorld` працюють у вихідних DXF WCS
без перетворення мм у метри. CSS pixels відлічуються від canvas;
scene = WCS − GetOrigin(). GetBounds() повертає WCS, FitView очікує scene.
Майбутні оверлеї мають використовувати цей контролер, а не незалежну камеру.

Зміна URL або Retry створюють нову сесію і renderer. Pan/zoom/resize не
запускають повторний Load. Відкладений скасовуваний старт прибирає зайвий
Load під час Strict Mode effect replay у dev. Dispose одразу прибирає
canvas, ResizeObserver і підписки; за наявності pending Load знищення WebGL
відкладене до його завершення. AbortSignal бібліотека не підтримує;
застарілі результати не змінюють поточний UI.

## Українські TEXT/MTEXT і шрифт

`fonts.ts` передає `fonts: [...DRAWING_FONT_URLS]` у кожний Load.
Використовується локальний незмінений Noto Sans Regular TTF 2.008:
`/fonts/noto-sans/NotoSans-Regular.ttf`. Джерело, checksum і SIL OFL —
у `public/fonts/noto-sans/README.md` та `OFL.txt`.

Шрифт читається ліниво, коли потрібен текст; байти може повернути HTTP-кеш,
але розібраний opentype font між сесіями бібліотека не кешує. Попри старий
коментар бібліотеки про typeface.js, встановлений loader читає TTF через
fetch/ArrayBuffer та opentype.parse. Це ресурс геометрії, не CSS @font-face.
Без fonts параметра текстова геометрія не будується.

Fixture `04_ukrainian_text.dxf` містить рамку 24 000 × 14 000 WCS і:

| Тип | Текст | Вставка X/Y | Висота | Поворот |
| --- | --- | --- | ---: | ---: |
| TEXT | Кімната 101 — Office | 1000 / 12000 | 500 | 0° |
| TEXT | Ґґ Єє Іі Її 0123456789 | 1000 / 11000 | 500 | 0° |
| MTEXT | Кухня / Kitchen; другий рядок Площа 24 м² | 1000 / 9000 | 500 | — |
| TEXT | Українська абетка великими літерами | 1000 / 5000 | 350 | 0° |
| TEXT | Українська абетка малими літерами | 1000 / 4000 | 350 | 0° |
| TEXT | Вихід / Exit | 22000 / 2000 | 500 | 90° |

MTEXT має ширину 18 000, attachmentPoint=1 і розрив рядка `\P`.
Апострофів у вихідному fixture немає.

### Фактично виконано 22.10.2026

- Перевірено ненульові glyph indices шрифту для Ґ, Є, І, Ї, є, і, ї, ґ
  та апострофів U+0027 ('), U+2019 (’), U+02BC (ʼ).
- Production-збірка локально відкривалася в ізольованому headless Chrome
  155.0.8059.86 через Chrome DevTools Protocol, без нових npm-залежностей.
- На знімку fit перевірено читабельність цих літер, обидві абетки,
  дворядковий MTEXT, менший розмір абеток і вертикальний «Вихід / Exit».
- Після кнопки zoom текст збільшується разом із геометрією, зберігає
  розміщення й поворот; обрізання краями viewport при наближенні очікуване.
  Fit повертає креслення в область перегляду.
- Для апострофів створено File лише в пам'яті з рядком
  «Ґ Є І Ї є і ї ґ П'ять П’ять Пʼять» на основі синтетичного fixture.
  Усі три варіанти видно на знімку; вихідні DXF, зокрема файли Дениса, не змінено.
- Наявні integration-тести зі справжнім TTF перевіряють TEXT/MTEXT,
  перенесення вставки, масштаб геометрії за висотою та поворот TEXT на 90°.

Локальні артефакти в ігнорованому `tmp/bim59-final/`:
`browser-check.mjs`, `browser-results.json`, `ukrainian-fit.png`,
`ukrainian-zoom.png`, `apostrophes-fit.png`. Вони не потраплять у PR автоматично.
Візуальне порівняння з еталонним CAD і приймання на хостингу не виконані.
Підтримка CAD/SHX-шрифтів і складного MTEXT обмежена dxf-viewer.

## Drag & Drop: реалізація та межі перевірки

Input і drop викликають спільну `openFile(File)`. Приймається один непорожній
файл із розширенням .dxf без урахування регістру. PDF/інший формат,
порожній файл і кілька файлів відхиляються українським повідомленням.
Невалідний вибір не замінює поточний DXF; новий валідний файл замінює його.
Input очищається після вибору, щоб дозволити повторний вибір того самого файла.

Поки сторінка змонтована, window handlers запобігають default-навігації
на file dragover/drop, включно з drop над canvas або поза рамкою.
Лічильник dragenter/dragleave керує підсвічуванням; drop/dragend/blur його
скидають. Cleanup прибирає handlers. Object URL належить ref: заміна,
закриття та unmount відкликають його; швидкі batched заміни не покладаються
на виконання effect для кожного проміжного state.

| Сценарій | Фактичний результат |
| --- | --- |
| Dragenter/dragover файла | Підсвічування й preventDefault підтверджено синтетичними DragEvents у production Chrome |
| Коректний DXF після drop | Автоматично відкрився, canvas готовий |
| Інший DXF поверх поточного canvas | Замінив поточний, попередній object URL відкликано |
| PDF, порожній DXF, кілька файлів | Показано відповідні українські помилки |
| Непорожній некоректний DXF, потім коректний | Помилка парсингу, потім успішне відкриття |
| Альтернативний input | Відкриття файла підтверджено через CDP setFileInputFiles |
| Object URL у перевіреній послідовності замін/помилок/закриттів | Створено 6, відкликано всі 6 |
| Небажана навігація | Drop events скасовані; URL залишився /drawing-preview |
| Uncaught exceptions / console warnings/errors у цьому прогоні | Не зафіксовано |
| Drag безпосередньо з Провідника Windows | Не перевірено; синтетичні DragEvents цього не підтверджують |
| Unmount cleanup, тривалий stress/heap-профіль | Переглянуто код cleanup; окремого браузерного stress/heap-тесту не виконано |

Усього у локальному браузерному сценарії пройшли 18 перевірок.
Це не заміна нативного OS drag-and-drop чи перевірки всіх браузерів.

### Ручне приймання перед завершенням

1. Запустіть production build/start і відкрийте саме /drawing-preview.
2. Перетягніть 01_simple_rooms_mm.dxf із Провідника Windows; перевірте
   підсвічування над рамкою та її дочірніми елементами, автоматичне відкриття.
3. Перетягніть інший DXF поверх canvas, потім PDF, порожній .dxf і два файли
   одночасно. Перевірте українські помилки та відсутність переходу з URL.
4. Відкрийте некоректний непорожній .dxf, потім справний файл; перевірте
   кнопку вибору, повторний вибір того самого файла, close/reopen.
5. Відкрийте 04_ukrainian_text.dxf; звірте таблицю TEXT/MTEXT, Ґ/Є/І/Ї та
   малі літери. Перевірте pan, колесо, кнопки zoom/fit, resize:
   текст не має відриватися від креслення чи змінювати пропорції.
6. На хостингу повторіть перевірку трьох DXF: 01_simple_rooms_mm.dxf,
   02_cafe_office_plan_mm.dxf, 03_bad_unclosed_meters.dxf; перевірте також
   доступність /fonts/noto-sans/NotoSans-Regular.ttf. Збережіть результати,
   браузер/ОС та помилки Console/Network. Цей крок ще не виконано.

## Продуктивність: результати та рішення

Складний файл:
`wooden-gothic-house-mini-two-floor-dollhouse-for-laser-cut-free.dxf`,
9 506 254 байти, 691 SPLINE; 142 092 контрольні точки загалом,
найбільша крива — 7 456. SHA-256:
`f595faa6fddf35025103b45e0e74e915dd23ac7bfbc1a72a923aab46c0ae6093`.

### Production browser: дані користувача

| Етап | Час |
| --- | ---: |
| Ініціалізація renderer (окремо від Load) | 19,5 мс |
| Читання/декодування DXF | 26,2 мс |
| Парсинг | 127,3 мс |
| Побудова сцени, обробка шрифтів, Three.js та перший render | 12 415,4 мс |
| Load разом | 12 568,9 мс ≈ 12,6 с |
| Запитів шрифту | 0 |

Основна затримка — інтервал побудови сцени. Користувач підтвердив плавні
криві, pan/zoom і відсутність помітних зависань після відкриття.
Ці виміри не повторювалися у фінальному headless-прогоні.

### Що саме вимірює API

`DxfViewer.Load` виконує Clear → DxfWorker.Load → batches/objects →
FitView/controls/Render. Без workerFactory клас DxfWorker працює на main thread.
DxfFetcher накопичує декодований рядок, надсилає parse і викликає parseSync.
DxfWorker надсилає prepare та виконує DxfScene.Build. Font callbacks
надсилають font перед fetch/ArrayBuffer і prepare ПЕРЕД opentype.parse.

Тому performance.now() інтервали такі: початок Load → parse (читання з
початковим overhead); parse → перший prepare (парсинг); кожний font →
prepare (очікування bytes шрифту); решта prepare → повернення Load
(побудова сцени, opentype, Three.js, перший render). Повторні prepare
накопичуються, а не стирають попередній час. При помилці інтервали часткові.
GPU працює асинхронно: окремий час GPU або фактичного показу кадру
не виміряний. Dynamic import canvas не входить у loadMs.

Результати доступні під viewer у «Діагностика завантаження» та Console
за [DrawingViewer load]. Порівнюйте production, холодний/повторні запуски,
стан кешу й обладнання; не змішуйте loadMs із dev compilation.

Власний діагностичний logger використовує явний список дозволених полів:
тільки скінченні числові timings/лічильники та outcome ready/error/cancelled.
URL, імена файлів, access token, сирі Error/Response і довільні додаткові
поля не передаються в console. Ідентифікатор операції наразі не потрібний;
URL не використовується для ідентифікації. Перевірено також DrawingViewer,
адаптер і preview: інших власних діагностичних console-викликів немає.
Це межа логування застосунку; браузерний Network і внутрішні повідомлення
сторонньої бібліотеки не є власними журналами та цим logger не перехоплюються.

### CPU-профіль Node: окреме середовище

Inspector sampling виконано без редагування бібліотеки, лише навколо
DxfScene.Build: Node 24.12.0 / V8 13.6.233.17-node.37, i7-12700K.
Build wall time 38 924,4 мс; 23 357 samples, зважене вікно 39 002,5 мс.
Частки обчислено через timeDeltas, requested interval 1 000 мкс.

| Self time | Оцінка | Частка профілю |
| --- | ---: | ---: |
| _InterpolateSpline | 31 338,3 мс | 80,35% |
| _DecomposeSpline | 5 162,1 мс | 13,24% |
| Garbage collector | 2 104,9 мс | 5,40% |
| _ProcessPolyline | 33,1 мс | 0,085% |

Inclusive _DecomposeSpline — 36 498,9 мс / 93,58%; він включає інтерполятор,
тому inclusive і self не додаються. GC не можна повністю приписати одній
функції; JIT/inlining впливає на віднесення семплів. Найгарячіший рядок
інтерполятора: `v[i][j] = points[i][j] * weights[i]` (12 773 position ticks).

Окремий counts-run із runtime wrappers на грубих межах, без заміни
інтерполятора: Build 42 664,5 мс; _DecomposeSpline сумарно 42 535,6 мс;
_ProcessPolyline 96,4 мс; _BuildScene 3,0 мс; font pre-scan 0,26 мс.
Найдовший SPLINE (handle 279) створив 29 825 вершин / 29 824 сегменти,
decompose 16 579,6 мс; handle 29D — 23 265 / 23 264, 8 432,8 мс.
Дві криві дали 58,6% Build цього інструментованого запуску.

Початковий Node-запуск без sampling: read 24,2 мс, parse 193,6 мс,
Build 36 838,5 мс, разом 37 056,3 мс. Це історичний додатковий вимір,
а не ще один browser result. Запуски відрізняються JIT/GC/overhead;
на їх основі не визначено точну вартість інструментації.

**Node-профілі не можна прямо прирівнювати до браузерних 12 415,4 мс.**
У Node не створювалися Three.js objects і WebGL renderer. Відсутній
browser CPU trace, який визначив би частку інтерполяції саме в браузері.

### Функції, геометрія та повторні обчислення

Конкретний шлях у встановленій 1.0.50:
DxfScene.Build → _ProcessDxfEntity → _DecomposeDxfEntity →
_DecomposeSpline → _InterpolateSpline → _ProcessPolyline →
Entity._IterateLineChunks / IndexedChunkWriter → _BuildScene /
RenderBatch.Serialize / IndexedChunk.Serialize.
Потім DxfViewer._LoadBatch → Batch.CreateObjects / _CreateObjects
створюють BufferGeometry/LineSegments. DynamicBuffer.Push/_CheckGrow/CopyTo
накопичують та копіюють buffers; _TransformVertex/_UpdateBounds обробляють WCS.

_DecomposeSpline генерує 4*n+1 sample. _InterpolateSpline на КОЖНИЙ sample
повторно створює одиничні weights, лінійно шукає knot span і готує масиви
всіх control points перед локальним de Boor. При фіксованому ступені
це приблизно квадратична робота за n. Для файла розраховано 704 576 588
проходів створення внутрішнього v[i] — не вимір фізичних allocations V8.

Фактичний вихід генератора й serialized buffers збіглися:
569 059 вершин, 568 368 сегментів, 1 136 736 Uint16 indices;
4 batches, 11 indexed chunks. За гілкою CreateObjects це 11 LineSegments,
не об'єкт на кожний сегмент. Vertex/index buffers — 4 552 472 /
2 273 472 байти, разом 6,51 MiB без тимчасової JS/GPU пам'яті.
Font requests=0, skipped entities=0. Надмірного множення фінальної
геометрії не виявлено; підтверджені витрати — повторна CPU-робота.

Локальні артефакти дослідження в ігнорованому `tmp/bim59-performance/`:
`probe.mjs`, `summarize-profile.mjs`, `build.cpuprofile`,
`profile.json`, `profile-summary.json`, `counts.json`.
Вони не є частиною application code або автоматично доступними в CI.

### Відкладені оптимізації

**Worker і зміни SPLINE не реалізовані; рішення про їх впровадження відкладено.**

Бібліотека підтримує workerFactory і DxfViewer.SetupWorker. Worker може
винести Fetch/parse/Build із UI thread, передавши buffers як transferable;
Three.js objects/Render залишаться на main thread. Це може покращити
чутливість UI, але не зменшує кількості sample і не гарантує скорочення
загального Load. Потрібні перевірки Next.js dev/prod bundling, URL шрифту,
CSP за наявності, termination/error/cleanup та швидкої заміни файла.

Оптимізацію evaluation, reuse scratch/weights/domain, monotonic span,
кеш сцени та повторне використання renderer можна розглядати лише за потреби
і погодженням. Навіть збереження sampling вимагає перевірки координат,
bounds, repeated knots, endpoints і floating-point відмінностей.
Зменшення subdivision/адаптивну апроксимацію не застосовано через ризик
для точності. Перед змінами корисний browser Performance trace;
це рекомендація, а не вже виконана перевірка.

## Локальне середовище: виправлена помилка AJV

Першопричина `Cannot find module 'ajv/dist/2020.js'` — неповне локальне
встановлення npm workspaces. Локального AJV 8 у contracts не було, тому
Node резолвив кореневий AJV 6.15.0, потрібний ESLint, без entry point 2020.
Також бракувало генератора типів та локального TypeScript contracts.
Саме співіснування AJV 6/8 коректне й передбачене lock-файлом.

Відновлено за чинним lock-файлом:

~~~powershell
npm.cmd ci --workspaces --include-workspace-root --include=dev
~~~

Підтверджено AJV 8.20.0 і dist/2020.js у contracts,
json-schema-to-typescript 16.0.0, TypeScript 7.0.2 і workspace links.
Після відновлення проходять lint/typecheck/31 test/build.
Вихідний код, схеми, generated.ts, manifests і lock-файл для виправлення
не змінювалися. Генерацію не запускали. Перша спроба ci мала EACCES
через обмеження середовища; повтор із розширеним доступом завершився успішно.

## Аудит залежностей і відоме обмеження

Повторно перевірено 22.10.2026 без зміни залежностей:

| Команда | Результат |
| --- | --- |
| npm.cmd audit --json | 5 High, exit code 1 |
| npm.cmd audit --omit=dev --json | 0 відомих vulnerabilities, exit code 0 |

Ланцюжок: eslint-config-next → @next/eslint-plugin-next → fast-glob →
micromatch → braces. Це 5 позначених пакетів у dev-ланцюжку; advisory braces:
https://github.com/advisories/GHSA-vfj7-8cjw-p6xm (stack-exhaustion DoS).

npm пропонує eslint-config-next 14.2.35 як major fix. Пониження до 14.x
не виконувалося через ризик несумісності з Next.js 16; npm audit fix
і npm audit fix --force не застосовувалися. Залишається відоме обмеження
інструментів розробки, яке слід повторно перевіряти при наступних оновленнях.
Нульовий production audit — результат відомих advisory у цьому дереві
залежностей на дату перевірки, а не гарантія абсолютної безпеки застосунку.

## Короткий підсумок BIM-59 для звіту

Реалізовано локальний DrawingViewer з WebGL, камерою, TEXT/MTEXT,
обробкою помилок і Drag & Drop. Перевірено production headless-сценарії
тексту/апострофів/відкриття файлів та автоматичні перевірки монорепозиторію.
Виправлено локальну установку workspaces без змін контрактів.
Задокументовано ~12,6 с на складному DXF, CPU hotspot SPLINE і dev audit.
Оптимізації відкладені. Залишаються нативне ручне приймання Windows,
інтеграція FastAPI після погодження з Дарією та перевірка трьох DXF
на хостингу після публікації. Публікацію, BIM-60/63 та Backend не виконували.
