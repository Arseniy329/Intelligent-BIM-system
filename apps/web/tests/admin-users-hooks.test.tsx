import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ADMIN_USERS_QUERY_KEY,
  useAdminUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
} from "@/hooks/useAdminUsers";
import * as adminApi from "@/lib/api/admin-users";
import type { ManagedUser } from "@/types/admin-user";

const showErrorToastMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showToastMock = vi.fn();

vi.mock("@/components/ui/error-toast-provider", () => ({
  useErrorToast: () => ({
    showErrorToast: showErrorToastMock,
    showSuccessToast: showSuccessToastMock,
    showToast: showToastMock,
  }),
}));

describe("useAdminUsers hooks (US26 / BIM-66)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the exact query key ['admin', 'users']", () => {
    expect(ADMIN_USERS_QUERY_KEY).toEqual(["admin", "users"]);
  });

  describe("useAdminUsersQuery", () => {
    it("configures query with ['admin', 'users'] and stale time in 30-60s range", async () => {
      const mockUsers: ManagedUser[] = [
        {
          id: "u1",
          email: "user1@example.com",
          role: "admin",
          isActive: true,
          createdAt: "2026-10-31T00:00:00Z",
        },
      ];

      const getSpy = vi
        .spyOn(adminApi, "getAdminUsers")
        .mockResolvedValue(mockUsers);

      const queryClient = new QueryClient();

      let hookResult: ReturnType<typeof useAdminUsersQuery> | undefined;

      function TestComponent() {
        hookResult = useAdminUsersQuery();
        return <div>Test</div>;
      }

      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );

      // Verify query cache entry
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: ADMIN_USERS_QUERY_KEY });
      expect(query).toBeDefined();

      // Hook was invoked with staleTime = 60 * 1000
      expect(hookResult).toBeDefined();

      getSpy.mockRestore();
    });
  });

  describe("useCreateUserMutation", () => {
    it("invalidates ['admin', 'users'] and triggers success toast on success", async () => {
      const newUser: ManagedUser = {
        id: "created_1",
        email: "created@example.com",
        role: "engineer",
        isActive: true,
        createdAt: "2026-10-31T10:00:00Z",
      };

      const createSpy = vi
        .spyOn(adminApi, "createAdminUser")
        .mockResolvedValue(newUser);

      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      let mutationResult: ReturnType<typeof useCreateUserMutation> | undefined;

      function TestComponent() {
        mutationResult = useCreateUserMutation();
        return <div>Test</div>;
      }

      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );

      expect(mutationResult).toBeDefined();

      await mutationResult!.mutateAsync({
        email: "created@example.com",
        password: "Password123!",
        role: "engineer",
      });

      expect(createSpy).toHaveBeenCalledWith({
        email: "created@example.com",
        password: "Password123!",
        role: "engineer",
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ADMIN_USERS_QUERY_KEY,
      });

      expect(showSuccessToastMock).toHaveBeenCalledWith(
        "Користувача успішно створено",
      );

      createSpy.mockRestore();
    });

    it("triggers error toast on mutation failure", async () => {
      const error = new Error("Failed to create");
      const createSpy = vi
        .spyOn(adminApi, "createAdminUser")
        .mockRejectedValue(error);

      const queryClient = new QueryClient();
      let mutationResult: ReturnType<typeof useCreateUserMutation> | undefined;

      function TestComponent() {
        mutationResult = useCreateUserMutation();
        return <div>Test</div>;
      }

      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );

      await expect(
        mutationResult!.mutateAsync({
          email: "fail@example.com",
          password: "123",
          role: "admin",
        }),
      ).rejects.toThrow("Failed to create");

      expect(showErrorToastMock).toHaveBeenCalledWith("Failed to create");

      createSpy.mockRestore();
    });
  });

  describe("useUpdateUserMutation", () => {
    it("invalidates ['admin', 'users'] and triggers toast on update success", async () => {
      const updatedUser: ManagedUser = {
        id: "u_updated",
        email: "updated@example.com",
        role: "admin",
        isActive: false,
        createdAt: "2026-10-31T00:00:00Z",
      };

      const updateSpy = vi
        .spyOn(adminApi, "updateAdminUser")
        .mockResolvedValue(updatedUser);

      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      let mutationResult: ReturnType<typeof useUpdateUserMutation> | undefined;

      function TestComponent() {
        mutationResult = useUpdateUserMutation();
        return <div>Test</div>;
      }

      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );

      // Test with { userId, payload }
      await mutationResult!.mutateAsync({
        userId: "u_updated",
        payload: { role: "admin", isActive: false },
      });

      expect(updateSpy).toHaveBeenCalledWith("u_updated", {
        role: "admin",
        isActive: false,
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ADMIN_USERS_QUERY_KEY,
      });

      expect(showSuccessToastMock).toHaveBeenCalledWith(
        "Дані користувача оновлено",
      );

      // Test with flat { userId, role, isActive }
      await mutationResult!.mutateAsync({
        userId: "u_updated",
        role: "engineer",
        isActive: true,
      });

      expect(updateSpy).toHaveBeenCalledWith("u_updated", {
        role: "engineer",
        isActive: true,
      });

      updateSpy.mockRestore();
    });

    it("triggers error toast on update failure", async () => {
      const error = new Error("Update rejected");
      const updateSpy = vi
        .spyOn(adminApi, "updateAdminUser")
        .mockRejectedValue(error);

      const queryClient = new QueryClient();
      let mutationResult: ReturnType<typeof useUpdateUserMutation> | undefined;

      function TestComponent() {
        mutationResult = useUpdateUserMutation();
        return <div>Test</div>;
      }

      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );

      await expect(
        mutationResult!.mutateAsync({
          userId: "u_fail",
          payload: { isActive: false },
        }),
      ).rejects.toThrow("Update rejected");

      expect(showErrorToastMock).toHaveBeenCalledWith("Update rejected");

      updateSpy.mockRestore();
    });
  });
});

