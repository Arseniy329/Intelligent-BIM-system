# Drawings Module

Rule: All file operations (DXF saving/parsing) MUST use the `/tmp` directory.

Note: Vercel Serverless Functions have a read-only filesystem except for the `/tmp` directory (ephemeral storage).

## GET /drawings

Returns only the authenticated user's drawings (filtered by `owner_id`), ordered newest first by `created_at DESC`. The client cannot pass a user id. Each item exposes a normalized `status` contract of exactly `pending`, `processing`, `done`, or `error`; legacy values such as `failed`, `completed`, or `queued` are mapped accordingly, and failed jobs remain visible with status `error`.
