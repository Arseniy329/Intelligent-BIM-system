import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminGuard } from "@/components/auth/admin-guard";
import { ApiAuthenticationError, ApiHttpError } from "@/lib/api";
import type { CurrentUser } from "@/types/admin-user";

const replaceMock = vi.fn();
let currentPathname = "/admin/users";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
  }),
  usePathname: () => currentPathname,
}));

const { currentUserState } = vi.hoisted(() => ({
  currentUserState: {
    value: {
      data: undefined as CurrentUser | undefined,
      isLoading: false,
      isError: false,
      error: null as unknown,
      refetch: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUserQuery: () => currentUserState.value,
}));

describe("Admin Route Guard & RBAC Protection (BIM-66 Phase 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = "/admin/users";
    currentUserState.value = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  });

  it("renders accessible loading spinner and DOES NOT render children while loading (No FOUC)", () => {
    currentUserState.value = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <AdminGuard>
        <div data-testid="protected-admin-content">SECRET_ADMIN_DATA</div>
      </AdminGuard>,
    );

    // Verify children content is NOT rendered (Zero FOUC)
    expect(html).not.toContain("SECRET_ADMIN_DATA");
    expect(html).not.toContain("protected-admin-content");

    // Verify loading indicators are accessible
    expect(html).toContain('role="status"');
    expect(html).toContain("Перевірка прав доступу…");
  });

  it("blocks unauthenticated user (ApiAuthenticationError), redirects to /login, and DOES NOT render children", () => {
    currentUserState.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiAuthenticationError(),
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <AdminGuard>
        <div data-testid="protected-admin-content">SECRET_ADMIN_DATA</div>
      </AdminGuard>,
    );

    // Verify children content is NOT rendered
    expect(html).not.toContain("SECRET_ADMIN_DATA");
    expect(html).not.toContain("protected-admin-content");

    // Verify redirection message is rendered
    expect(html).toContain("Перенаправлення на сторінку входу…");
    expect(html).toContain('role="status"');
  });

  it("blocks unauthenticated user with 401 ApiHttpError and DOES NOT render children", () => {
    currentUserState.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiHttpError(401, "Token expired"),
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <AdminGuard>
        <div data-testid="protected-admin-content">SECRET_ADMIN_DATA</div>
      </AdminGuard>,
    );

    expect(html).not.toContain("SECRET_ADMIN_DATA");
    expect(html).toContain("Перенаправлення на сторінку входу…");
  });

  it("denies access to an engineer (role: 'engineer') with dedicated 403 Forbidden screen", () => {
    currentUserState.value = {
      data: {
        id: "usr_eng_123",
        email: "engineer@company.ua",
        role: "engineer",
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <AdminGuard>
        <div data-testid="protected-admin-content">SECRET_ADMIN_DATA</div>
      </AdminGuard>,
    );

    // Verify children content is NOT rendered
    expect(html).not.toContain("SECRET_ADMIN_DATA");
    expect(html).not.toContain("protected-admin-content");

    // Verify dedicated 403 Forbidden alert
    expect(html).toContain('role="alert"');
    expect(html).toContain("403 — Доступ заборонено");
    expect(html).toContain("Доступ заборонено. Потрібні права адміністратора.");

    // Verify return navigation buttons
    expect(html).toContain("Повернутися на головну");
    expect(html).toContain("Мої креслення");
  });

  it("allows access to an admin (role: 'admin') and renders children content normally", () => {
    currentUserState.value = {
      data: {
        id: "usr_admin_999",
        email: "admin@company.ua",
        role: "admin",
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <AdminGuard>
        <div data-testid="protected-admin-content">SECRET_ADMIN_DATA</div>
      </AdminGuard>,
    );

    // Verify children content IS rendered
    expect(html).toContain("SECRET_ADMIN_DATA");
    expect(html).toContain('data-testid="protected-admin-content"');

    // Verify 403 or loading is NOT rendered
    expect(html).not.toContain("403 — Доступ заборонено");
    expect(html).not.toContain("Перевірка прав доступу…");
  });

  it("handles unexpected server error (500) gracefully without exposing children", () => {
    currentUserState.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiHttpError(500, "Internal Server Error"),
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <AdminGuard>
        <div data-testid="protected-admin-content">SECRET_ADMIN_DATA</div>
      </AdminGuard>,
    );

    // Verify children content is NOT rendered
    expect(html).not.toContain("SECRET_ADMIN_DATA");
    expect(html).toContain("Помилка автентифікації");
    expect(html).toContain("Повторити спробу");
  });
});
