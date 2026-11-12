import type { ReactNode } from "react";
import { AppHeader, type AppHeaderNavItem } from "@/components/app-header";
import { PageContainer } from "@/components/layout/page-container";

const appShellNavItems: AppHeaderNavItem[] = [
  { href: "/rules", label: "Правила й норми" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bim-color-surface-page)] text-[var(--bim-color-text-primary)]">
      <AppHeader navItems={appShellNavItems} />
      <PageContainer as="main" className="flex-1 py-6 sm:py-8">
        {children}
      </PageContainer>
    </div>
  );
}
