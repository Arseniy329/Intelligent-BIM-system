from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class BIMException(Exception):
    """Base exception for Intelligent BIM API."""

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class NotFoundError(BIMException):
    def __init__(
        self, message: str = "Resource not found", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message=message, status_code=404, details=details)


class ValidationError(BIMException):
    def __init__(
        self, message: str = "Validation failed", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message=message, status_code=422, details=details)


class ConflictError(BIMException):
    def __init__(
        self, message: str = "Conflict detected", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message=message, status_code=409, details=details)


class DatabaseError(BIMException):
    def __init__(
        self,
        message: str = "Database operation failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, status_code=502, details=details)


class StorageError(BIMException):
    def __init__(
        self,
        message: str = "Storage operation failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, status_code=400, details=details)


class CADParsingError(BIMException):
    def __init__(
        self,
        message: str = "CAD parsing failed",
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, status_code=status_code, details=details)


class LayerNotFoundError(CADParsingError):
    def __init__(
        self,
        message: str = "Required layer 'FIRE_ROOMS' not found in DXF file",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, status_code=400, details=details)


class NoValidContoursError(CADParsingError):
    def __init__(
        self,
        message: str = "No valid closed room contours found on layer 'FIRE_ROOMS'",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, status_code=400, details=details)


async def bim_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Global exception handler for custom BIM exceptions."""
    if isinstance(exc, BIMException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.__class__.__name__,
                "message": exc.message,
                "details": exc.details,
            },
        )
    return JSONResponse(
        status_code=500,
        content={
            "error": "InternalServerError",
            "message": str(exc),
            "details": {},
        },
    )
