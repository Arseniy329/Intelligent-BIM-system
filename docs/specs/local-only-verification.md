# Local-Only Verification Recipe

This runbook defines the only verification commands that may be executed inside
this repository's micro-agent shells. Verification uses fast one-shot commands
that exit on their own and finish well inside a 300 s worker timeout. No command
in this recipe needs remote network access, a container runtime, a database CLI
service, or a long-running development server.

## Scope

This is a test/docs harness change. It must not alter API endpoints, Pydantic
schemas, database migrations, authentication, placement logic, or UI behaviour.

## Allowed one-shot commands

The commands below are safe, self-terminating, and local-only. Run them from the
repository root unless a block starts with a `cd`.

### API

```bash
cd apps/api
python -m pytest -q
ruff check .
```

Fast subset for a quick API check:

```bash
cd apps/api
python -m pytest tests/test_health.py -q
ruff check src tests
```

### Web

```bash
cd apps/web
npm test -- --run
npx vitest run
npx tsc --noEmit
```

### Shared contracts

```bash
cd packages/contracts
npx tsc --noEmit
npx vitest run
```

## Full local sequence

This block chains the allowed commands with `&&` so the sequence stops at the
first failure:

```bash
cd apps/api && python -m pytest -q && ruff check . \
  && cd ../web && npm test -- --run && npx vitest run && npx tsc --noEmit \
  && cd ../../packages/contracts && npx tsc --noEmit && npx vitest run
```

## Rules

- Every command in this recipe is one-shot and exits on its own.
- No command may attach to a terminal, watch files, or expose a port.
- Pre-existing unrelated failures must be reported rather than silently fixed.

## Prohibited commands

Any command that boots a daemon, a container runtime, a database CLI service, or
a long-running development server is banned in this recipe and inside
micro-agent shells. The explicit, authoritative list of banned entries lives in
`docs/specs/local-only-verification.denylist.txt`; consult that file by path
instead of inferring the list from this runbook. This runbook must never
reproduce any banned entry literally.
