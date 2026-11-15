import type {
  CreateUserPayload,
  CurrentUser,
  ManagedUser,
  RawManagedUser,
  UpdateUserPayload,
  UserRole,
} from "@/types/admin-user";
import {
  apiFetch,
  ApiAuthenticationError,
  ApiConfigurationError,
  ApiHttpError,
} from "@/lib/api";

export const ADMIN_USERS_API_PATH = "/api/admin/users";
export const USERS_ME_API_PATH = "/api/v1/users/me";

/**
 * GET /api/v1/users/me -> Promise<CurrentUser>
 * Retrieves the current authenticated user session and role.
 */
export async function getCurrentUser(
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const response = await apiFetch(USERS_ME_API_PATH, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiAuthenticationError();
    }
    const detail = await parseApiError(response);
    throw new ApiHttpError(response.status, detail);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const role: UserRole = raw?.role === "admin" ? "admin" : "engineer";

  return {
    id: String(raw?.id ?? ""),
    email: typeof raw?.email === "string" ? raw.email : null,
    role,
  };
}

/**
 * Normalizes a raw user record into a strictly typed ManagedUser interface.
 * Handles both camelCase and snake_case fields (e.g. isActive vs is_active, createdAt vs created_at).
 */
export function normalizeManagedUser(raw: unknown): ManagedUser {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid user record: expected an object");
  }

  const record = raw as RawManagedUser;

  const id = typeof record.id === "string" ? record.id : String(record.id ?? "");
  if (!id) {
    throw new Error("Invalid user record: missing id");
  }

  const email =
    typeof record.email === "string" ? record.email : String(record.email ?? "");

  const role: UserRole = record.role === "admin" ? "admin" : "engineer";

  let isActive = true;
  if (typeof record.isActive === "boolean") {
    isActive = record.isActive;
  } else if (typeof record.is_active === "boolean") {
    isActive = record.is_active;
  } else if (record.isActive !== undefined && record.isActive !== null) {
    isActive = Boolean(record.isActive);
  } else if (record.is_active !== undefined && record.is_active !== null) {
    isActive = Boolean(record.is_active);
  }

  const rawCreatedAt = record.createdAt ?? record.created_at;
  const createdAt =
    typeof rawCreatedAt === "string"
      ? rawCreatedAt
      : rawCreatedAt instanceof Date
        ? rawCreatedAt.toISOString()
        : new Date().toISOString();

  return {
    id,
    email,
    role,
    isActive,
    createdAt,
  };
}

/**
 * Normalizes an array of raw user records into ManagedUser[].
 */
export function normalizeManagedUsers(raw: unknown): ManagedUser[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => normalizeManagedUser(item));
}

/**
 * Extracts error details from a failed API response body.
 */
export async function parseApiError(response: Response): Promise<string> {
  let errorDetail = "";
  try {
    const errData = (await response.json()) as Record<string, unknown>;
    if (typeof errData?.detail === "string") {
      errorDetail = errData.detail;
    } else if (Array.isArray(errData?.detail)) {
      errorDetail = errData.detail
        .map((item) => {
          if (typeof item === "object" && item !== null && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return JSON.stringify(item);
        })
        .join("; ");
    } else if (typeof errData?.message === "string") {
      errorDetail = errData.message;
    }
  } catch {
    // Non-JSON response body
  }
  return errorDetail;
}

/**
 * Returns a user-friendly Ukrainian error message for common admin user API errors.
 */
export function getAdminErrorMessage(error: unknown): string {
  if (
    error instanceof ApiAuthenticationError ||
    (error instanceof ApiHttpError && error.statusCode === 401)
  ) {
    return "Сеанс завершився. Увійдіть у свій обліковий запис знову.";
  }
  if (error instanceof ApiHttpError) {
    if (error.statusCode === 403) {
      return "Доступ заборонено. Потрібні права адміністратора.";
    }
    if (error.statusCode === 404) {
      return "Користувача не знайдено.";
    }
    if (error.statusCode === 409) {
      return (
        error.detail ||
        "Користувач із такою електронною поштою вже існує."
      );
    }
    if (error.statusCode === 422) {
      return (
        error.detail ||
        "Некоректні дані користувача. Перевірте введені значення."
      );
    }
    if (error.statusCode >= 500) {
      return "Помилка сервера. Спробуйте пізніше.";
    }
    if (error.detail) {
      return error.detail;
    }
  }
  if (error instanceof ApiConfigurationError) {
    return "З’єднання з API не налаштовано.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Сталася помилка при взаємодії з сервером.";
}

/**
 * GET /api/admin/users -> Promise<ManagedUser[]>
 */
export async function getAdminUsers(
  signal?: AbortSignal,
): Promise<ManagedUser[]> {
  const response = await apiFetch(ADMIN_USERS_API_PATH, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    const detail = await parseApiError(response);
    throw new ApiHttpError(response.status, detail);
  }

  const rawJson = (await response.json()) as unknown;
  return normalizeManagedUsers(rawJson);
}

/**
 * POST /api/admin/users -> Promise<ManagedUser> (accepts CreateUserPayload)
 */
export async function createAdminUser(
  payload: CreateUserPayload,
  signal?: AbortSignal,
): Promise<ManagedUser> {
  const response = await apiFetch(ADMIN_USERS_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      role: payload.role,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await parseApiError(response);
    throw new ApiHttpError(response.status, detail);
  }

  const rawJson = (await response.json()) as unknown;
  return normalizeManagedUser(rawJson);
}

/**
 * PATCH /api/admin/users/${userId} -> Promise<ManagedUser> (accepts UpdateUserPayload)
 */
export async function updateAdminUser(
  userId: string,
  payload: UpdateUserPayload,
  signal?: AbortSignal,
): Promise<ManagedUser> {
  const path = `${ADMIN_USERS_API_PATH}/${encodeURIComponent(userId)}`;

  const body: Record<string, unknown> = {};
  if (payload.role !== undefined) {
    body.role = payload.role;
  }
  if (payload.isActive !== undefined) {
    body.is_active = payload.isActive;
    body.isActive = payload.isActive;
  }

  const response = await apiFetch(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const detail = await parseApiError(response);
    throw new ApiHttpError(response.status, detail);
  }

  const rawJson = (await response.json()) as unknown;
  return normalizeManagedUser(rawJson);
}

export const adminUsersApi = {
  getUsers: getAdminUsers,
  listUsers: getAdminUsers,
  createUser: createAdminUser,
  updateUser: updateAdminUser,
  getCurrentUser,
};

