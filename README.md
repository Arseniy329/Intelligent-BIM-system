# Інтелектуальна BIM-система

Монорепозиторій вебплатформи для завантаження DXF, визначення приміщень, розміщення приладів пожежної сигналізації та формування результату для AutoCAD.

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

Потрібен Node.js 22 або новіший.

```bash
npm install
cp .env.example .env.local
npm run contracts:generate
npm run dev
```

Вебзастосунок буде доступний за адресою `http://localhost:3000`.

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
