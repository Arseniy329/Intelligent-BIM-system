from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


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
