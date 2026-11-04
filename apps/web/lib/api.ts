import type { DrawingDetailStatus, DrawingStatus, RequestedDrawingUnits } from "@bim/contracts";
import { createClient } from "@/lib/supabase/client";

export const DRAWINGS_API_PATH = "/api/v1/drawings";

export type DrawingUiStatus = DrawingDetailStatus | DrawingStatus;

export class ApiAuthenticationError extends Error {
  constructor() {
    super("Authentication is required for this API request.");
    this.name = "ApiAuthenticationError";
  }
}

export class ApiConfigurationError extends Error {
  constructor() {
    super("The API URL is not configured correctly.");
    this.name = "ApiConfigurationError";
  }
}

export class ApiPathError extends Error {
  constructor() {
    super("The API path is invalid.");
    this.name = "ApiPathError";
  }
}

export class ApiHttpError extends Error {
  statusCode: number;
  detail?: string;

  constructor(statusCode: number, detail?: string) {
    super(
      detail
        ? `API request failed with status ${statusCode}: ${detail}`
        : `API request failed with status ${statusCode}`,
    );
    this.name = "ApiHttpError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export interface NormalizedSignedUpload {
  url: string;
  path: string;
  expiresInSeconds: number;
}

export interface NormalizedDrawingRecord {
  id: string;
  ownerId: string;
  originalFileName: string;
  storagePath: string;
  units: RequestedDrawingUnits;
  status: DrawingUiStatus;
  createdAt: string;
}

export interface NormalizedCreateDrawingResponse {
  drawing: NormalizedDrawingRecord;
  upload: NormalizedSignedUpload;
}

function getApiBaseUrl(): URL {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!configuredUrl) {
    throw new ApiConfigurationError();
  }

  try {
    const baseUrl = new URL(configuredUrl);

    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new ApiConfigurationError();
    }

    return baseUrl;
  } catch {
    throw new ApiConfigurationError();
  }
}

function getApiUrl(path: string): URL {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(path) ||
    /%(?![\da-fA-F]{2})/.test(path)
  ) {
    throw new ApiPathError();
  }

  const baseUrl = getApiBaseUrl();
  const basePath = baseUrl.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  try {
    // Accept an existing /api/v1 base configuration without doubling its prefix.
    const endpoint = basePath.endsWith("/api/v1") && path.startsWith("/api/v1/") ? path.slice("/api/v1".length) : path;
    const url = new URL(`${baseUrl.origin}${basePath}${endpoint}`);

    if (url.origin !== baseUrl.origin || (basePath && !url.pathname.startsWith(`${basePath}/`))) {
      throw new ApiPathError();
    }

    return url;
  } catch {
    throw new ApiPathError();
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = getApiUrl(path);
  let accessToken: string | undefined;

  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.getSession();

    if (!error) {
      accessToken = data.session?.access_token;
    }
  } catch {
    // Authentication failures are intentionally reported without session details.
  }

  if (!accessToken) {
    throw new ApiAuthenticationError();
  }

  const headers = new Headers(init?.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(url, { ...init, headers });
}

/**
 * Normalizes a raw drawing object from the backend (snake_case or camelCase)
 * into a single consistent frontend DrawingUiStatus-typed shape.
 */
export function normalizeDrawingRecord(
  raw: Record<string, unknown>,
): NormalizedDrawingRecord {
  const rawStatus = String(raw?.status ?? "uploaded");
  let status: DrawingUiStatus = "uploaded";
  if (
    rawStatus === "pending" ||
    rawStatus === "uploaded" ||
    rawStatus === "processing" ||
    rawStatus === "processed" ||
    rawStatus === "failed" ||
    rawStatus === "error"
  ) {
    status = rawStatus;
  }

  return {
    id: String(raw.id || ""),
    ownerId: String(raw.ownerId ?? raw.owner_id ?? ""),
    originalFileName: String(
      raw.originalFileName ?? raw.original_file_name ?? "",
    ),
    storagePath: String(
      raw.storagePath ?? raw.storage_path ?? "",
    ),
    units: (raw.units ?? "mm") as RequestedDrawingUnits,
    status,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

/**
 * Normalizes the backend POST /api/v1/drawings response into a single,
 * consistent contract-aligned shape (handling camelCase vs snake_case).
 */
export function normalizeCreateDrawingResponse(
  raw: Record<string, unknown>,
): NormalizedCreateDrawingResponse {
  const rawDrawing = (raw?.drawing as Record<string, unknown>) || {};
  const rawUpload = (raw?.upload as Record<string, unknown>) || {};

  return {
    drawing: normalizeDrawingRecord(rawDrawing),
    upload: {
      url: String(rawUpload.url || ""),
      path: String(rawUpload.path || ""),
      expiresInSeconds: Number(
        rawUpload.expiresInSeconds ?? rawUpload.expires_in_seconds ?? 3600,
      ),
    },
  };
}

/**
 * Lists the authenticated user's drawings via GET /api/v1/drawings.
 * Normalizes backend snake_case records into camelCase NormalizedDrawingRecord items.
 */
export async function listDrawings(
  signal?: AbortSignal,
): Promise<NormalizedDrawingRecord[]> {
  const response = await apiFetch(DRAWINGS_API_PATH, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errData = await response.json();
      errorDetail = errData?.detail || errData?.message || "";
    } catch {
      // Ignore JSON parsing errors for non-JSON responses
    }
    throw new ApiHttpError(response.status, errorDetail);
  }

  const rawJson = (await response.json()) as unknown;
  if (!Array.isArray(rawJson)) {
    return [];
  }

  return rawJson.map((item) =>
    normalizeDrawingRecord((item as Record<string, unknown>) || {}),
  );
}

/**
 * Creates a drawing record via authenticated apiFetch.
 * Sends ONLY the fields accepted by FastAPI's CreateDrawingRequest:
 * `original_file_name` and `units`.
 */
export async function createDrawing(
  input: { fileName: string; units: RequestedDrawingUnits },
  signal?: AbortSignal,
): Promise<NormalizedCreateDrawingResponse> {
  const payload = {
    original_file_name: input.fileName,
    units: input.units,
  };

  const response = await apiFetch(DRAWINGS_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errData = await response.json();
      errorDetail = errData?.detail || errData?.message || "";
    } catch {
      // Ignore JSON parsing errors for non-JSON responses
    }
    throw new ApiHttpError(response.status, errorDetail);
  }

  const rawJson = (await response.json()) as Record<string, unknown>;
  return normalizeCreateDrawingResponse(rawJson);
}
