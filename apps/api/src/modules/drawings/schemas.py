from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

from src.contracts.generated import DrawingResult


class DrawingStatus(str, Enum):  # noqa: UP042
    uploaded = "uploaded"
    processing = "processing"
    processed = "processed"
    failed = "failed"


DrawingRecordStatus = Literal[
    "pending", "uploaded", "processing", "processed", "failed", "error"
]
DrawingUnits = Literal["mm", "m", "from_file"]


class CreateDrawingRequest(BaseModel):
    original_file_name: str = Field(..., min_length=1)
    units: DrawingUnits = "mm"


class UploadSignedUrl(BaseModel):
    url: str
    path: str
    expires_in_seconds: int


class DrawingRecord(BaseModel):
    id: str
    owner_id: str
    original_file_name: str
    storage_path: str
    units: str
    status: DrawingRecordStatus
    created_at: datetime


class DrawingListItem(BaseModel):
    id: str
    filename: str
    uploaded_at: datetime
    status: DrawingStatus
    error_message: str | None = None
    has_result: bool


class CreateDrawingResponse(BaseModel):
    drawing: DrawingRecord
    upload: UploadSignedUrl


class DrawingDetailResponse(BaseModel):
    id: str
    owner_id: str
    original_file_name: str
    storage_path: str
    units: str
    status: DrawingRecordStatus
    created_at: datetime
    source_download_url: str | None = None
    source_download_url_expires_at: datetime | None = None


class DrawingResultWithReport(DrawingResult):
    """Результат креслення разом зі збереженим звітом останнього розміщення.

    Контракт ``DrawingResult`` генерується зі схеми й не змінюється, тож звіт —
    окреме необов'язкове поле, яке GET /drawings/{id} додає ЛИШЕ коли звіт є
    (без звіту відповідь точно відповідає ``DrawingResult``). Форма значення
    збігається з відповіддю POST /place (``placement_status``, ``device_count``,
    ``skipped``): клієнт читає обидва одним розбором. Щоб внести поле в спільний
    контракт, потрібна окрема зміна ``contracts.schema.json`` і перегенерація.
    """

    placementReport: dict[str, Any] = Field(
        ...,
        description=(
            "Звіт останнього кроку розміщення: чи оброблено все креслення і що "
            "пропущено та чому."
        ),
    )
