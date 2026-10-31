import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminLayout from "@/app/admin/layout";
import AdminUsersPage from "@/app/admin/users/page";
import { ErrorToastProvider } from "@/components/ui/error-toast-provider";
import * as adminApi from "@/lib/api/admin-users";
import type { CurrentUser, ManagedUser } from "@/types/admin-user";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
  usePathname: () => "/admin/users",
}));

describe("Admin Layout & Users Page Component (BIM-66 Phase 2)", () => {
  const adminUser: CurrentUser = {
    id: "admin_1",
    email: "admin@test.ua",
    role: "admin",
  };

  const sampleUsers: ManagedUser[] = [
    {
      id: "u1",
      email: "engineer@test.ua",
      role: "engineer",
      isActive: true,
      createdAt: "2026-10-31T00:00:00Z",
    },
    {
      id: "u2",
      email: "admin@test.ua",
      role: "admin",
      isActive: true,
      createdAt: "2026-10-30T00:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders AdminLayout with header and breadcrumbs when user is an admin", async () => {
    const queryClient = new QueryClient();
    vi.spyOn(adminApi, "getCurrentUser").mockResolvedValue(adminUser);

    await queryClient.prefetchQuery({
      queryKey: ["users", "me"],
      queryFn: () => adminApi.getCurrentUser(),
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ErrorToastProvider>
          <AdminLayout>
            <div>Nested admin view</div>
          </AdminLayout>
        </ErrorToastProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain("Панель адміністратора");
    expect(html).toContain("Керування користувачами");
    expect(html).toContain("Nested admin view");
  });

  it("renders AdminUsersPage with action bar, user count, and users table", async () => {
    const queryClient = new QueryClient();
    vi.spyOn(adminApi, "getAdminUsers").mockResolvedValue(sampleUsers);
    vi.spyOn(adminApi, "getCurrentUser").mockResolvedValue(adminUser);

    await queryClient.prefetchQuery({
      queryKey: ["admin", "users"],
      queryFn: () => adminApi.getAdminUsers(),
    });
    await queryClient.prefetchQuery({
      queryKey: ["users", "me"],
      queryFn: () => adminApi.getCurrentUser(),
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ErrorToastProvider>
          <AdminUsersPage />
        </ErrorToastProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain("Керування користувачами");
    expect(html).toContain("Всього користувачів: 2");
    expect(html).toContain("+ Створити користувача");
    expect(html).toContain("engineer@test.ua");
    expect(html).toContain("admin@test.ua");
  });

  it("renders AdminUsersPage loading state properly", () => {
    const queryClient = new QueryClient();
    vi.spyOn(adminApi, "getAdminUsers").mockReturnValue(
      new Promise<ManagedUser[]>(() => {}),
    );
    vi.spyOn(adminApi, "getCurrentUser").mockReturnValue(
      new Promise<CurrentUser>(() => {}),
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ErrorToastProvider>
          <AdminUsersPage />
        </ErrorToastProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain("Завантаження списку користувачів");
    expect(html).toContain('role="status"');
  });
});
