from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from supabase import Client

from src.core.config import get_settings
from src.infrastructure.storage import cleanup_file, download_dxf_to_tmp
from src.modules.cad.parser import read_length_scale
from src.modules.cad.writer import DEFAULT_DEVICE_TYPE, add_devices_to_dxf


def stored_unit_scale_m(drawing: dict[str, Any]) -> float | None:
    """``drawings.unit_scale_m`` (metres per drawing unit), if it is set."""
    try:
        scale = float(drawing.get("unit_scale_m") or 0.0)
    except (TypeError, ValueError):
        return None
    return scale if scale > 0 else None


def get_unit_scale_m(drawing: dict[str, Any], supabase: Client) -> float:
    """Metres per drawing unit for a drawing row.

    Processing stores the parser's $INSUNITS scale in ``unit_scale_m``
    (migration 007). Drawings processed earlier have NULL there: read
    $INSUNITS once from the source DXF and store it. This never reprocesses
    the drawing, so rooms and manual edits stay as they are.

    Raises:
        HTTPException: 502 if the source DXF cannot be downloaded or read;
            a guessed scale would silently give wrong areas.
    """
    stored = stored_unit_scale_m(drawing)
    if stored is not None:
        return stored

    tmp_path: Path | None = None
    try:
        storage_path = drawing.get("storage_path")
        if not storage_path:
            raise ValueError("drawing has no storage_path")
        tmp_path = download_dxf_to_tmp(str(storage_path), client=supabase)
        scale = read_length_scale(tmp_path)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read drawing units from the source DXF",
        ) from exc
    finally:
        cleanup_file(tmp_path)

    supabase.table("drawings").update({"unit_scale_m": scale}).eq(
        "id", str(drawing["id"])
    ).execute()
    drawing["unit_scale_m"] = scale
    return scale


def generate_and_upload_result_dxf(drawing_id: str, supabase: Client) -> str:
    """Generate result DXF with placed device blocks and upload to Supabase storage.

    Fetches devices from the database for the given drawing, adds a block
    reference per device (block chosen by device type) to a copy of the
    source DXF, and uploads the
    modified drawing to '<owner_id>/<drawing_id>/result.dxf'.

    Args:
        drawing_id: UUID string of the drawing record.
        supabase: Authenticated Supabase client.

    Returns:
        The Supabase storage path where the result DXF was uploaded.

    Raises:
        HTTPException: If the drawing record is not found or invalid.
    """
    settings = get_settings()

    drawing_response = (
        supabase.table("drawings").select("*").eq("id", drawing_id).single().execute()
    )
    drawing_data = drawing_response.data
    if not isinstance(drawing_data, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Drawing not found",
        )

    owner_id = drawing_data.get("owner_id")
    source_storage_path = drawing_data.get("storage_path")
    if not owner_id or not source_storage_path:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Drawing record missing owner_id or storage_path",
        )

    devices_response = (
        supabase.table("devices").select("*").eq("drawing_id", drawing_id).execute()
    )
    devices_data = (
        devices_response.data if isinstance(devices_response.data, list) else []
    )

    devices: list[tuple[float, float, str]] = []
    for dev in devices_data:
        if not isinstance(dev, dict):
            continue
        device_type = str(dev.get("type") or DEFAULT_DEVICE_TYPE)
        if "x" in dev and "y" in dev and dev["x"] is not None and dev["y"] is not None:
            devices.append((float(dev["x"]), float(dev["y"]), device_type))
        elif "position" in dev and isinstance(dev["position"], dict):
            pos = dev["position"]
            if (
                "x" in pos
                and "y" in pos
                and pos["x"] is not None
                and pos["y"] is not None
            ):
                devices.append((float(pos["x"]), float(pos["y"]), device_type))

    input_tmp_path: Path | None = None
    output_tmp_path: Path | None = None
    try:
        input_tmp_path = download_dxf_to_tmp(source_storage_path, client=supabase)
        output_tmp_path = Path("/tmp") / f"{uuid4()}_result.dxf"

        add_devices_to_dxf(input_tmp_path, output_tmp_path, devices)

        output_storage_path = f"{owner_id}/{drawing_id}/result.dxf"
        supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).upload(
            path=output_storage_path,
            file=str(output_tmp_path),
            file_options={"content-type": "application/dxf", "x-upsert": "true"},
        )

        return output_storage_path
    finally:
        cleanup_file(input_tmp_path)
        cleanup_file(output_tmp_path)
