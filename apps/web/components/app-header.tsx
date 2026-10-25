import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { PageContainer } from "@/components/layout/page-container";

export function AppHeader() {
  return (
    <header className="border-b border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)]">
      <PageContainer className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Link
          href="/upload"
          className="inline-flex min-h-10 max-w-full items-center rounded-sm px-2 text-base font-semibold text-[var(--bim-color-text-primary)] hover:bg-[var(--bim-color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
        >
          Інтелектуальна BIM-система
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <nav aria-label="Основна навігація">
            <Link
              href="/upload"
              className="inline-flex min-h-10 items-center rounded-sm px-2 text-sm font-medium text-[var(--bim-color-border-focus)] hover:bg-[var(--bim-color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
            >
              Завантажити
            </Link>
          </nav>
          <LogoutButton />
        </div>
      </PageContainer>
    </header>
  );
}
