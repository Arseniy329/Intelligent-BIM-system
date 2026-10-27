from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

DrawingStatus = Literal["pending", "uploaded", "processing", "processed", "failed"]
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
    status: DrawingStatus
    created_at: datetime


class CreateDrawingResponse(BaseModel):
    drawing: DrawingRecord
    upload: UploadSignedUrl


class DrawingDetailResponse(BaseModel):
    id: str
    owner_id: str
    original_file_name: str
    storage_path: str
    units: str
    status: DrawingStatus
    created_at: datetime
    source_download_url: Optional[str] = None
    source_download_url_expires_at: Optional[datetime] = None