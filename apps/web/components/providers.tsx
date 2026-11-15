"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorToastProvider } from "@/components/ui/error-toast-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorToastProvider>{children}</ErrorToastProvider>
    </QueryClientProvider>
  );
}
