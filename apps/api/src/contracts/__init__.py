"""Generated Pydantic models and API contracts."""

from src.contracts.generated import (
    BimContracts,
    CreateDrawingRequest,
    CreateDrawingResponse,
    Device,
    Drawing,
    DrawingResult,
    DrawingStatus,
    DrawingUnits,
    Point,
    Room,
    SignedUpload,
    Type,
)
from src.contracts.norms import (
    NormLookupContext,
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
    is_disallowed_document,
    is_official_domain,
)

__all__ = [
    "BimContracts",
    "CreateDrawingRequest",
    "CreateDrawingResponse",
    "Device",
    "Drawing",
    "DrawingResult",
    "DrawingStatus",
    "DrawingUnits",
    "Point",
    "Room",
    "SignedUpload",
    "Type",
    "NormLookupContext",
    "NormLookupRequest",
    "NormLookupResult",
    "NormVerificationStatus",
    "is_disallowed_document",
    "is_official_domain",
]
