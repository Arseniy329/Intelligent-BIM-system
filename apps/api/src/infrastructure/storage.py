import urllib.request
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from supabase import Client

from src.core.config import get_settings
from src.core.exceptions import StorageError
from src.infrastructure.supabase import get_supabase_client


def download_dxf_to_tmp(
    file_path: str,
    client: Client | None = None,
    bucket_name: str | None = None,
) -> Path:
    """Download DXF from Supabase Storage (or trusted URL) to /tmp/{uuid}.dxf.

    Args:
        file_path: Supabase storage path or trusted Supabase URL.
        client: Optional authenticated Supabase client.
        bucket_name: Optional bucket name override; defaults to settings.

    Returns:
        Path to the saved temporary file in /tmp.

    Raises:
        StorageError: If download fails, file is empty, or URL is untrusted.
    """
    if not file_path or not file_path.strip():
        raise StorageError("File path must not be empty.")

    cleaned_path = file_path.strip()
    settings = get_settings()

    # 1. URL download (strictly restricted to configured Supabase URL to prevent SSRF)
    if cleaned_path.startswith(("http://", "https://")):
        requested_url = urlsplit(cleaned_path)
        trusted_url = urlsplit(settings.SUPABASE_URL)
        if (
            requested_url.scheme != trusted_url.scheme
            or requested_url.hostname != trusted_url.hostname
            or requested_url.port != trusted_url.port
            or requested_url.username is not None
            or requested_url.password is not None
        ):
            raise StorageError(f"Untrusted URL domain: '{cleaned_path}'")

        try:
            safe_url = (
                f"{trusted_url.scheme}://{trusted_url.netloc}{requested_url.path}"
            )
            if requested_url.query:
                safe_url = f"{safe_url}?{requested_url.query}"
            req = urllib.request.Request(
                safe_url,
                headers={"User-Agent": "Intelligent-BIM-API/1.0"},
            )
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                data = resp.read()
        except Exception as exc:
            raise StorageError(
                f"Failed to download file from URL '{cleaned_path}': {exc}"
            ) from exc

    # 2. Supabase Storage download
    else:
        settings = get_settings()
        bucket = bucket_name or settings.SUPABASE_STORAGE_BUCKET
        sb_client = client
        if sb_client is None:
            sb_client = get_supabase_client(settings)

        storage_path = cleaned_path.lstrip("/")
        if storage_path.startswith(f"{bucket}/"):
            storage_path = storage_path[len(bucket) + 1 :]

        try:
            data = sb_client.storage.from_(bucket).download(storage_path)
        except Exception as exc:
            raise StorageError(
                f"Failed to download '{storage_path}' from bucket '{bucket}': {exc}"
            ) from exc

    if not data:
        raise StorageError(f"Downloaded file '{file_path}' is empty.")

    tmp_dir = Path("/tmp")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = tmp_dir / f"{uuid.uuid4()}.dxf"

    try:
        temp_path.write_bytes(data)
    except Exception as exc:
        raise StorageError(
            f"Failed to write temporary file '{temp_path}': {exc}"
        ) from exc

    return temp_path


def cleanup_file(path: Path | str | None) -> None:
    """Safely delete a temporary file if it exists."""
    if path is None:
        return
    try:
        p = Path(path)
        if p.exists():
            p.unlink()
    except OSError:
        pass


@contextmanager
def temporary_dxf_file(
    file_path: str,
    client: Client | None = None,
    bucket_name: str | None = None,
) -> Iterator[Path]:
    """Context manager to download a DXF file to /tmp and guarantee cleanup."""
    temp_path = download_dxf_to_tmp(file_path, client=client, bucket_name=bucket_name)
    try:
        yield temp_path
    finally:
        cleanup_file(temp_path)


download_dxf_file = temporary_dxf_file
