# Інтелектуальна BIM-система

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
