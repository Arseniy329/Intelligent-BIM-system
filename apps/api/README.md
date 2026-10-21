# Intelligent BIM API (`apps/api`)

FastAPI backend for the Intelligent BIM system, designed for deployment on Vercel Serverless Functions and Supabase REST API.

## Architecture

- **Entrypoint**: `api/index.py` (Vercel Serverless wrapper exposing `app` from `src.main`)
- **Configuration**: `src/core/config.py` (`BaseSettings` requiring `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`)
- **Global Exceptions**: `src/core/exceptions.py`
- **Contracts**: `src/contracts/` (Pydantic models generated from `packages/contracts/schemas/contracts.schema.json`)
- **Infrastructure**: `src/infrastructure/supabase.py` (REST-based Supabase client dependency injection without persistent DB pools)
- **Vertical Slices**: `src/modules/`
  - `drawings/`: Drawing management and ingestion (**Rule: All file operations (DXF saving/parsing) MUST use `/tmp`**)
  - `cad/`: CAD geometric extraction and ezdxf/shapely operations
  - `rules/`: Fire safety rules and compliance checks
  - `users/`: User profile and authorization helpers
- **Developer Experience**: A root `Makefile` orchestrates development tasks, while `requirements-dev.txt` isolates tooling (Ruff, Mypy) from production dependencies.

## Setup & Local Development

Create and activate a virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate
```

1. **Install Dependencies**:
   ```bash
   make install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in Supabase credentials:
   ```bash
   cp .env.example .env
   ```

3. **Generate Pydantic Models**:
   ```bash
   make models
   ```

4. **Run Server**:
   ```bash
   make dev
   ```

5. **Code Quality & Type Checking**:
   ```bash
   make format
   make lint
   make check
   ```

6. **Run Tests**:
   ```bash
   make test
   ```

## Serverless Constraints

- **Read-Only Filesystem**: Vercel Serverless functions run on a read-only filesystem. All ephemeral operations (such as temporary DXF parsing) must write exclusively to `/tmp`.
- **Database Connection**: Do not use persistent connection pools (e.g. SQLAlchemy engine pools). All database interactions must use the `supabase` REST client.
