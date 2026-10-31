import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_USERS_API_PATH,
  adminUsersApi,
  createAdminUser,
  getAdminErrorMessage,
  getAdminUsers,
  getCurrentUser,
  normalizeManagedUser,
  normalizeManagedUsers,
  updateAdminUser,
} from "@/lib/api/admin-users";
import {
  ApiAuthenticationError,
  ApiConfigurationError,
  ApiHttpError,
} from "@/lib/api";
import type { CreateUserPayload, UpdateUserPayload } from "@/types/admin-user";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

const fetchMock = vi.fn();

describe("Admin Users API Client (BIM-58 / BIM-66)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "mock-admin-token" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("normalizeManagedUser", () => {
    it("normalizes backend snake_case fields correctly", () => {
      const raw = {
        id: "usr_123",
        email: "engineer@example.com",
        role: "engineer",
        is_active: true,
        created_at: "2026-10-30T10:00:00Z",
      };

      const user = normalizeManagedUser(raw);
      expect(user).toEqual({
        id: "usr_123",
        email: "engineer@example.com",
        role: "engineer",
        isActive: true,
        createdAt: "2026-10-30T10:00:00Z",
      });
    });

    it("normalizes frontend camelCase fields correctly", () => {
      const raw = {
        id: "usr_456",
        email: "admin@example.com",
        role: "admin",
        isActive: false,
        createdAt: "2026-10-31T12:00:00Z",
      };

      const user = normalizeManagedUser(raw);
      expect(user).toEqual({
        id: "usr_456",
        email: "admin@example.com",
        role: "admin",
        isActive: false,
        createdAt: "2026-10-31T12:00:00Z",
      });
    });

    it("defaults role to engineer if not explicitly admin", () => {
      const user = normalizeManagedUser({
        id: "usr_789",
        email: "user@example.com",
        role: "other",
        is_active: true,
        created_at: "2026-10-31T12:00:00Z",
      });
      expect(user.role).toBe("engineer");
    });

    it("throws if input is not an object or missing id", () => {
      expect(() => normalizeManagedUser(null)).toThrow(
        "Invalid user record: expected an object",
      );
      expect(() => normalizeManagedUser({ email: "no-id@test.com" })).toThrow(
        "Invalid user record: missing id",
      );
    });

    it("normalizeManagedUsers returns empty array for non-array input", () => {
      expect(normalizeManagedUsers(null)).toEqual([]);
      expect(normalizeManagedUsers({})).toEqual([]);
    });
  });

  describe("getAdminUsers", () => {
    it("calls GET /api/admin/users with authorization and returns normalized users", async () => {
      const rawBackendList = [
        {
          id: "u1",
          email: "admin@example.com",
          role: "admin",
          is_active: true,
          created_at: "2026-10-01T00:00:00Z",
        },
        {
          id: "u2",
          email: "eng@example.com",
          role: "engineer",
          is_active: false,
          created_at: "2026-10-02T00:00:00Z",
        },
      ];

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(rawBackendList), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const controller = new AbortController();
      const users = await getAdminUsers(controller.signal);

      expect(users).toHaveLength(2);
      expect(users[0]).toEqual({
        id: "u1",
        email: "admin@example.com",
        role: "admin",
        isActive: true,
        createdAt: "2026-10-01T00:00:00Z",
      });
      expect(users[1]).toEqual({
        id: "u2",
        email: "eng@example.com",
        role: "engineer",
        isActive: false,
        createdAt: "2026-10-02T00:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toBe(`https://api.example${ADMIN_USERS_API_PATH}`);
      expect(init.method).toBe("GET");
      expect(init.signal).toBe(controller.signal);
      expect(init.headers.get("Authorization")).toBe("Bearer mock-admin-token");
    });

    it("handles 401 Unauthorized gracefully", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ detail: "Token expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(getAdminUsers()).rejects.toThrow(ApiHttpError);
      try {
        await getAdminUsers();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiHttpError);
        expect((err as ApiHttpError).statusCode).toBe(401);
      }
    });

    it("handles 403 Forbidden when user is not an admin", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ detail: "Admin privileges required" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );

      try {
        await getAdminUsers();
        expect.unreachable("Should have thrown ApiHttpError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiHttpError);
        expect((err as ApiHttpError).statusCode).toBe(403);
      }
    });

    it("handles 500 Internal Server Error gracefully", async () => {
      fetchMock.mockResolvedValue(
        new Response("Server Error", {
          status: 500,
        }),
      );

      try {
        await getAdminUsers();
        expect.unreachable("Should have thrown ApiHttpError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiHttpError);
        expect((err as ApiHttpError).statusCode).toBe(500);
      }
    });
  });

  describe("createAdminUser", () => {
    it("calls POST /api/admin/users with payload and returns normalized user", async () => {
      const payload: CreateUserPayload = {
        email: "newuser@example.com",
        password: "SecretPassword123!",
        role: "engineer",
      };

      const backendResponse = {
        id: "new_id_1",
        email: "newuser@example.com",
        role: "engineer",
        is_active: true,
        created_at: "2026-10-31T15:00:00Z",
      };

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(backendResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await createAdminUser(payload);
      expect(result).toEqual({
        id: "new_id_1",
        email: "newuser@example.com",
        role: "engineer",
        isActive: true,
        createdAt: "2026-10-31T15:00:00Z",
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toBe(`https://api.example${ADMIN_USERS_API_PATH}`);
      expect(init.method).toBe("POST");
      expect(init.headers.get("Content-Type")).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it("handles 422 Unprocessable Entity with FastAPI detail array", async () => {
      const payload: CreateUserPayload = {
        email: "invalid-email",
        password: "123",
        role: "engineer",
      };

      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: [
              { msg: "value is not a valid email address" },
              { msg: "password must be at least 8 characters" },
            ],
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      );

      try {
        await createAdminUser(payload);
        expect.unreachable("Should have thrown ApiHttpError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiHttpError);
        expect((err as ApiHttpError).statusCode).toBe(422);
        expect((err as ApiHttpError).detail).toContain(
          "value is not a valid email address",
        );
      }
    });
  });

  describe("updateAdminUser", () => {
    it("calls PATCH /api/admin/users/:userId with payload", async () => {
      const payload: UpdateUserPayload = {
        role: "admin",
        isActive: false,
      };

      const backendResponse = {
        id: "u_to_update",
        email: "user@example.com",
        role: "admin",
        is_active: false,
        created_at: "2026-10-01T00:00:00Z",
      };

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(backendResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await updateAdminUser("u_to_update", payload);
      expect(result).toEqual({
        id: "u_to_update",
        email: "user@example.com",
        role: "admin",
        isActive: false,
        createdAt: "2026-10-01T00:00:00Z",
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toBe(
        `https://api.example${ADMIN_USERS_API_PATH}/u_to_update`,
      );
      expect(init.method).toBe("PATCH");
      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.role).toBe("admin");
      expect(parsedBody.is_active).toBe(false);
      expect(parsedBody.isActive).toBe(false);
    });

    it("encodes userId containing special characters", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "user/with-slash",
            email: "slash@example.com",
            role: "engineer",
            is_active: true,
            created_at: "2026-10-01T00:00:00Z",
          }),
          { status: 200 },
        ),
      );

      await updateAdminUser("user/with-slash", { isActive: true });
      const [url] = fetchMock.mock.calls[0];
      expect(url.toString()).toBe(
        `https://api.example${ADMIN_USERS_API_PATH}/user%2Fwith-slash`,
      );
    });
  });

  describe("getCurrentUser", () => {
    it("calls GET /api/v1/users/me and returns normalized CurrentUser", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "me_1",
            email: "me@bim.ua",
            role: "admin",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const user = await getCurrentUser();
      expect(user).toEqual({
        id: "me_1",
        email: "me@bim.ua",
        role: "admin",
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toBe("https://api.example/api/v1/users/me");
      expect(init.method).toBe("GET");
      expect(init.headers.get("Authorization")).toBe("Bearer mock-admin-token");
    });

    it("throws ApiAuthenticationError when 401 is returned", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ detail: "Unauthorized" }), {
          status: 401,
        }),
      );

      await expect(getCurrentUser()).rejects.toThrow(
        ApiAuthenticationError,
      );
    });

    it("defaults role to engineer when backend role is not admin", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "eng_1",
            email: "eng@bim.ua",
            role: "engineer",
          }),
          { status: 200 },
        ),
      );

      const user = await getCurrentUser();
      expect(user.role).toBe("engineer");
    });
  });

  describe("adminUsersApi object wrapper", () => {
    it("provides getters and mutators via adminUsersApi", () => {
      expect(adminUsersApi.getUsers).toBe(getAdminUsers);
      expect(adminUsersApi.listUsers).toBe(getAdminUsers);
      expect(adminUsersApi.createUser).toBe(createAdminUser);
      expect(adminUsersApi.updateUser).toBe(updateAdminUser);
    });
  });

  describe("getAdminErrorMessage", () => {
    it("formats 401 as session expired message", () => {
      const err = new ApiHttpError(401);
      expect(getAdminErrorMessage(err)).toBe(
        "Сеанс завершився. Увійдіть у свій обліковий запис знову.",
      );
    });

    it("formats 403 as admin permission required message", () => {
      const err = new ApiHttpError(403);
      expect(getAdminErrorMessage(err)).toBe(
        "Доступ заборонено. Потрібні права адміністратора.",
      );
    });

    it("formats 404 as user not found message", () => {
      const err = new ApiHttpError(404);
      expect(getAdminErrorMessage(err)).toBe("Користувача не знайдено.");
    });

    it("formats 409 as duplicate user message or detail", () => {
      const errDefault = new ApiHttpError(409);
      expect(getAdminErrorMessage(errDefault)).toBe(
        "Користувач із такою електронною поштою вже існує.",
      );

      const errCustom = new ApiHttpError(409, "User email duplicate");
      expect(getAdminErrorMessage(errCustom)).toBe("User email duplicate");
    });

    it("formats 422 with detail message", () => {
      const err = new ApiHttpError(422, "Email вже використовується");
      expect(getAdminErrorMessage(err)).toBe("Email вже використовується");
    });

    it("formats 500 as server error message", () => {
      const err = new ApiHttpError(500);
      expect(getAdminErrorMessage(err)).toBe(
        "Помилка сервера. Спробуйте пізніше.",
      );
    });

    it("formats ApiAuthenticationError", () => {
      const err = new ApiAuthenticationError();
      expect(getAdminErrorMessage(err)).toBe(
        "Сеанс завершився. Увійдіть у свій обліковий запис знову.",
      );
    });

    it("formats ApiConfigurationError", () => {
      const err = new ApiConfigurationError();
      expect(getAdminErrorMessage(err)).toBe("З’єднання з API не налаштовано.");
    });
  });
});

