"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query";
import {
  createAdminUser,
  getAdminErrorMessage,
  getAdminUsers,
  updateAdminUser,
} from "@/lib/api/admin-users";
import type {
  CreateUserPayload,
  ManagedUser,
  UpdateUserPayload,
} from "@/types/admin-user";
import { useErrorToast } from "@/components/ui/error-toast-provider";

export const ADMIN_USERS_QUERY_KEY = ["admin", "users"] as const;

/**
 * Query hook for listing admin-managed users.
 * - Query key: ['admin', 'users']
 * - Stale time: 60s (within 30-60s requirement)
 */
export function useAdminUsersQuery(
  options?: Omit<
    UseQueryOptions<ManagedUser[], Error, ManagedUser[], typeof ADMIN_USERS_QUERY_KEY>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ADMIN_USERS_QUERY_KEY,
    queryFn: ({ signal }) => getAdminUsers(signal),
    staleTime: 60 * 1000,
    ...options,
  });
}

/**
 * Mutation hook for creating a new user via POST /api/admin/users.
 * - On success: invalidates ['admin', 'users'] and triggers a success toast.
 * - On error: displays appropriate error toast.
 */
export function useCreateUserMutation(
  options?: UseMutationOptions<ManagedUser, Error, CreateUserPayload>,
) {
  const queryClient = useQueryClient();
  const toast = useErrorToast();

  return useMutation({
    mutationFn: (payload: CreateUserPayload) => createAdminUser(payload),
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: ADMIN_USERS_QUERY_KEY,
      });
      if (typeof toast.showSuccessToast === "function") {
        toast.showSuccessToast("Користувача успішно створено");
      } else {
        toast.showToast?.("Користувача успішно створено", "success");
      }
      await options?.onSuccess?.(...args);
    },
    onError: (...args) => {
      const [error] = args;
      const message = getAdminErrorMessage(error);
      toast.showErrorToast(message);
      options?.onError?.(...args);
    },
    ...options,
  });
}

export type UpdateUserVariables =
  | {
      userId: string;
      payload: UpdateUserPayload;
    }
  | ({
      userId: string;
    } & UpdateUserPayload);

/**
 * Mutation hook for updating an existing user via PATCH /api/admin/users/${userId}.
 * - On success: invalidates ['admin', 'users'] and triggers a toast.
 * - On error: displays appropriate error toast.
 */
export function useUpdateUserMutation(
  options?: UseMutationOptions<ManagedUser, Error, UpdateUserVariables>,
) {
  const queryClient = useQueryClient();
  const toast = useErrorToast();

  return useMutation({
    mutationFn: (variables: UpdateUserVariables) => {
      const userId = variables.userId;
      const payload: UpdateUserPayload =
        "payload" in variables && variables.payload !== undefined
          ? variables.payload
          : {
              role: "role" in variables ? variables.role : undefined,
              isActive: "isActive" in variables ? variables.isActive : undefined,
            };
      return updateAdminUser(userId, payload);
    },
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: ADMIN_USERS_QUERY_KEY,
      });
      if (typeof toast.showSuccessToast === "function") {
        toast.showSuccessToast("Дані користувача оновлено");
      } else {
        toast.showToast?.("Дані користувача оновлено", "success");
      }
      await options?.onSuccess?.(...args);
    },
    onError: (...args) => {
      const [error] = args;
      const message = getAdminErrorMessage(error);
      toast.showErrorToast(message);
      options?.onError?.(...args);
    },
    ...options,
  });
}
