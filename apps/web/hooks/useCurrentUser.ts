"use client";

import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/api/admin-users";
import type { CurrentUser } from "@/types/admin-user";

export const CURRENT_USER_QUERY_KEY = ["users", "me"] as const;

/**
 * Hook to retrieve the currently authenticated user and their assigned role.
 * - Stale time: 5 minutes (user role rarely changes mid-session)
 * - retry: false (avoids retry delay when unauthenticated or unauthorized)
 */
export function useCurrentUserQuery(
  options?: Omit<
    UseQueryOptions<CurrentUser, Error, CurrentUser, typeof CURRENT_USER_QUERY_KEY>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: ({ signal }) => getCurrentUser(signal),
    staleTime: 5 * 60 * 1000,
    retry: false,
    ...options,
  });
}

