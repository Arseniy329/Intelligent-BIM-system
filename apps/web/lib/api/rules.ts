import { apiFetch, ApiHttpError } from "@/lib/api";

export type RuleStatus =
  | "verified"
  | "needs_verification"
  | "pending"
  | string;

export interface Rule {
  id: string;
  rule: string;
  value: string;
  room_type?: string | null;
  room_height_min?: number | null;
  room_height_max?: number | null;
  document: string;
  clause: string;
  link?: string | null;
  status: RuleStatus;
  checked_at?: string | null;
}

export interface RulesResponse {
  items: Rule[];
  total?: number;
}

export interface NormLookupResponse {
  document: string;
  clause: string;
  link?: string | null;
  status: RuleStatus;
  value?: string | null;
  answer?: string;
  requires_engineer_review?: boolean;
}

export const RULES_API_PATH = "/api/v1/rules";
export const NORMS_LOOKUP_API_PATH = "/api/v1/norms/lookup";

async function getErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data?.detail === "string") {
      return data.detail;
    }
    if (typeof data?.message === "string") {
      return data.message;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return "";
}

function toRule(raw: unknown): Rule {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    rule: String(record.rule ?? ""),
    value: String(record.value ?? ""),
    room_type: (record.room_type ?? null) as string | null,
    room_height_min: (record.room_height_min ?? null) as number | null,
    room_height_max: (record.room_height_max ?? null) as number | null,
    document: String(record.document ?? ""),
    clause: String(record.clause ?? ""),
    link: (record.link ?? null) as string | null,
    status: String(record.status ?? "") as RuleStatus,
    checked_at: (record.checked_at ?? null) as string | null,
  };
}

/**
 * GET /api/v1/rules -> Promise<Rule[]>
 * Accepts either a bare array or a `{ items }` envelope.
 */
export async function fetchRules(signal?: AbortSignal): Promise<Rule[]> {
  const response = await apiFetch(RULES_API_PATH, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    const detail = await getErrorDetail(response);
    throw new ApiHttpError(
      response.status,
      detail || `Не вдалося завантажити правила (HTTP ${response.status}).`,
    );
  }

  const data = (await response.json()) as unknown;
  if (Array.isArray(data)) {
    return data.map(toRule);
  }

  const items = (data as RulesResponse | null)?.items;
  if (Array.isArray(items)) {
    return items.map(toRule);
  }

  return [];
}

/**
 * POST /api/v1/norms/lookup -> Promise<NormLookupResponse>
 */
export async function lookupNorm(
  query: string,
  signal?: AbortSignal,
): Promise<NormLookupResponse> {
  const response = await apiFetch(NORMS_LOOKUP_API_PATH, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal,
  });

  if (!response.ok) {
    const detail = await getErrorDetail(response);
    throw new ApiHttpError(
      response.status,
      detail || `Не вдалося виконати пошук норм (HTTP ${response.status}).`,
    );
  }

  return (await response.json()) as NormLookupResponse;
}
