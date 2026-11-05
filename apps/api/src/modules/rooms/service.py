import json
import re
from pathlib import Path
from typing import Any

ROOM_TYPES_PATH = Path(__file__).with_name("room_types.json")
UNKNOWN_ROOM_TYPE = "unknown"


def get_room_types() -> list[dict[str, Any]]:
    """Read the room-type catalog from JSON."""
    data = json.loads(ROOM_TYPES_PATH.read_text(encoding="utf-8"))

    if not isinstance(data, list):
        raise ValueError("Room type catalog must be a JSON list")

    for item in data:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("code"), str)
            or not isinstance(item.get("name"), str)
            or not isinstance(item.get("examples"), list)
        ):
            raise ValueError("Invalid room type entry in catalog")

    return data


def _normalize_name(value: str) -> str:
    # DXF fixtures may append area in parentheses, e.g. Main_Corridor (24.0m2).
    value = re.sub(r"\([^)]*\)", " ", value)
    value = value.replace("_", " ")
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return " ".join(value.casefold().split())


def suggest_room_type(room_name: str | None) -> str:
    """Return a catalog code for an exact example match, or 'unknown'."""
    normalized_name = _normalize_name(room_name or "")

    for room_type in get_room_types():
        examples = room_type["examples"]
        for example in examples:
            if isinstance(example, str) and normalized_name == _normalize_name(example):
                return room_type["code"]

    return UNKNOWN_ROOM_TYPE


def room_type_exists(code: str) -> bool:
    return any(item["code"] == code for item in get_room_types())