import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";

export function AppHeader() {
  return (
    <header className="border-b border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)]">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <span className="text-base font-semibold">Інтелектуальна BIM-система</span>
        <div className="flex flex-wrap items-center gap-4">
          <nav aria-label="Основна навігація">
            <Link
              href="/upload"
              className="rounded-sm text-sm font-medium text-[var(--bim-color-border-focus)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
            >
              Завантаження
            </Link>
          </nav>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
