# Інтелектуальна BIM-система

## Власники сервісів

- GitHub repository owner: Arseniy329
- Vercel project owner: arseniy-zagor
- Production region: Frankfurt (`fra1`)

## Структура

```text
apps/
  web/                 Next.js інтерфейс
  api/                 FastAPI: креслення, CAD-парсер і розміщення пристроїв
packages/
  contracts/           JSON Schema, TypeScript-типи та приклади JSON
docs/                   архітектурні й процесні документи
```

## Локальний запуск

```bash
npm install
cp .env.example .env.local
npm run contracts:generate
npm run dev
```

## Перевірки

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Такі самі перевірки запускає GitHub Actions для кожного Pull Request і для змін у `main`.

## Середовище

`.env.example` містить лише назви потрібних змінних. Реальні ключі зберігаються локально або в налаштуваннях хостингу й не комітяться.

## Деплой

Інструкція підготовлена в [docs/deployment.md](docs/deployment.md). У цьому локальному варіанті жодного зовнішнього деплою не виконано.

## Supabase setup

1. Create a Supabase project and enable Email + password authentication.
2. Create a private Storage bucket named `drawings` with a 50 MB file size limit.
3. Set its name in `SUPABASE_STORAGE_BUCKET` in your local/server environment.
4. Run migrations:

   ```bash
   supabase db push
   ```

For a database where `001` and `002` have already run, apply `003` as a new migration.
Review existing `admin` profiles separately: a role assigned before this fix cannot
be distinguished automatically from a legitimate administrator.

## BIM-62 → BIM-63

Після upload сторінка `/drawings/[id]` отримує метадані через
`GET /api/v1/drawings/{id}`, відкриває оригінальний DXF у DrawingViewer
і дозволяє скачати його після повторного GET для актуального signed URL.
`NEXT_PUBLIC_API_URL` задає адресу API-сервера. Спільний клієнт використовує
префікс `/api/v1` рівно один раз, зокрема для конфігурації, що вже містить цей префікс.

`POST /api/v1/drawings/{id}/process` наразі повертає HTTP 200 `accepted`:
це заглушка, яка не запускає обробку. Jobs endpoint, результат із приміщеннями
та пристроями й URL згенерованого DXF ще не підключені до цього потоку.
Клієнт пояснює обмеження, не запускає polling і не підміняє результат оригіналом.

Деморежим, межі перевірки та інструкції тестів описані в
[README DrawingViewer/BIM-63](apps/web/components/drawing/README.md#bim-63--інтеграція-bim-47bim-62-29102026).
