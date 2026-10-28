import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { PageContainer } from "@/components/layout/page-container";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bim-color-surface-page)] text-[var(--bim-color-text-primary)]">
      <AppHeader />
      <PageContainer as="main" className="flex-1 py-6 sm:py-8">
        {children}
      </PageContainer>
    </div>
  );
}
