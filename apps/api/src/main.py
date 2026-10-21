from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client

from src.core.config import get_settings
from src.core.exceptions import BIMException, bim_exception_handler
from src.infrastructure.supabase import get_supabase_client
from src.modules.cad.router import router as cad_router
from src.modules.drawings.router import router as drawings_router
from src.modules.rules.router import router as rules_router
from src.modules.users.router import router as users_router

settings = get_settings()

app = FastAPI(
    title="Intelligent BIM API",
    description="FastAPI backend for Intelligent BIM System",
    version="0.1.0",
)

# Exception handlers
app.add_exception_handler(BIMException, bim_exception_handler)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vertical slice routers
app.include_router(drawings_router, prefix="/api/v1")
app.include_router(cad_router, prefix="/api/v1")
app.include_router(rules_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
@app.get("/healthz", tags=["system"])
async def health_check(
    supabase: Annotated[Client, Depends(get_supabase_client)],
) -> dict:
    """Health check endpoint verifying database connectivity via Supabase client."""
    timestamp = datetime.now(UTC).isoformat()
    try:
        # Ping Supabase REST API (PostgREST)
        response = supabase.postgrest.session.get(f"{supabase.rest_url}/", timeout=5.0)
        db_status = "connected" if response.status_code < 500 else "error"
    except Exception:
        db_status = "disconnected"

    return {
        "status": "ok",
        "database": {"status": db_status},
        "timestamp": timestamp,
    }
