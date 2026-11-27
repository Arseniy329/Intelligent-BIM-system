"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchFindings } from "./findings";

/** Each committed drawing revision gets its own request and abort signal. */
export function useFindings(id: string, revision: number, enabled: boolean) {
  return useQuery({
    queryKey: ["drawing-findings", id, revision],
    queryFn: ({ signal }) => fetchFindings(id, signal),
    enabled, retry: false, staleTime: Infinity, gcTime: 0,
    refetchOnWindowFocus: false,
  });
}
