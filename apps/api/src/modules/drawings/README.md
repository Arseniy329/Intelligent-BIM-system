# Drawings Module

Rule: All file operations (DXF saving/parsing) MUST use the `/tmp` directory.

Note: Vercel Serverless Functions have a read-only filesystem except for the `/tmp` directory (ephemeral storage).

## GET /drawings

Authenticated endpoint (`Authorization: Bearer <token>`). Returns only the caller's drawings, filtered by the token's user id (`drawings.owner_id`), ordered newest first by `created_at DESC`. Requests without a valid token receive `401`. The client can never supply a user id via query or path parameters; the filter always comes from the token.

Response items use snake_case field names:

```json
[
  {
    "id": "4f7c...",
    "filename": "office_floor_1.dxf",
    "uploaded_at": "2026-10-29T10:00:00Z",
    "status": "processed",
    "error_message": null,
    "has_result": true
  }
]
```

- `id` — drawing UUID.
- `filename` — original uploaded file name (`drawings.original_file_name`).
- `uploaded_at` — ISO-8601 timestamp from `drawings.created_at`.
- `status` — one of `uploaded`, `processing`, `processed`, `failed`.
- `error_message` — populated only for `failed`; `null` otherwise.
- `has_result` — `true` when a stored placement result (rooms/devices) exists for the drawing, so the UI can open the saved plan instead of only the source DXF.

Status values follow the drawing status machine defined alongside `supabase/migrations/003_secure_profiles_and_drawing_status.sql` (`uploaded`, `processing`, `processed`, `failed`). Legacy or unknown status values are never returned: they are mapped to `failed` with a human-readable `error_message` instead of raising an error.
