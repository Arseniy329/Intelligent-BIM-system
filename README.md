# Інтелектуальна BIM-система

## Власники сервісів

- GitHub repository owner: Arseniy329
- Vercel project owner: arseniy-zagor
- Production region: Frankfurt (`fra1`)

## Структура

```text
apps/
  web/                 Next.js інтерфейс
  api/                 місце для FastAPI (BIM-53)
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

## Фрагмент коду

NEXT_PUBLIC_SUPABASE_URL=[https://qgkxerxiyzpbeczkpbpj.supabase.co](https://qgkxerxiyzpbeczkpbpj.supabase.co)
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_QzDEiRpdtdNWmx-ASHI-QA_3CQiU3zB

## Supabase setup

1. Create Supabase project.
2. Enable Email + password auth:
   - Authentication → Providers → Email
   - Enable Email sign in
3. Create bucket:
   - Storage → Create bucket
   - Bucket name: `drawings`
   - Private: yes
   - File size limit: 50 MB
4. Run migrations:
   ```bash
   supabase db push