from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from supabase import Client

from src.core.config import get_settings
from src.infrastructure.storage import cleanup_file, download_dxf_to_tmp
from src.modules.cad.writer import add_sensors_to_dxf


def generate_and_upload_result_dxf(drawing_id: str, supabase: Client) -> str:
    """Generate result DXF with placed sensor blocks and upload to Supabase storage.

    Fetches device placements from the database for the given drawing, adds
    sensor block references to a copy of the source DXF, and uploads the
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

    sensor_coords: list[tuple[float, float]] = []
    for dev in devices_data:
        if not isinstance(dev, dict):
            continue
        if "x" in dev and "y" in dev and dev["x"] is not None and dev["y"] is not None:
            sensor_coords.append((float(dev["x"]), float(dev["y"])))
        elif "position" in dev and isinstance(dev["position"], dict):
            pos = dev["position"]
            if (
                "x" in pos
                and "y" in pos
                and pos["x"] is not None
                and pos["y"] is not None
            ):
                sensor_coords.append((float(pos["x"]), float(pos["y"])))

    input_tmp_path: Path | None = None
    output_tmp_path: Path | None = None
    try:
        input_tmp_path = download_dxf_to_tmp(source_storage_path, client=supabase)
        output_tmp_path = Path("/tmp") / f"{uuid4()}_result.dxf"

        add_sensors_to_dxf(input_tmp_path, output_tmp_path, sensor_coords)

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
