"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { PageContainer } from "@/components/layout/page-container";

export type AppHeaderNavItem = {
  href: string;
  label: string;
};

export function AppHeader({
  navItems = [],
}: {
  navItems?: AppHeaderNavItem[];
}) {
  const pathname = usePathname();
  const drawingWorkspace = pathname === "/drawing-preview" || /^\/drawings\/[^/]+$/.test(pathname ?? "");

  if (drawingWorkspace) return <header className="drawing-workspace-header">
    <Link href="/drawings" className="drawing-workspace-brand">
      <Image src="/design/bim-107/logo.svg" width={40} height={40} alt="" unoptimized />
      <span><strong>Інтелектуальна BIM</strong><small>Пожежна безпека</small></span>
    </Link>
    <div className="drawing-workspace-account">
      <Link href="/upload" className="drawing-workspace-new">＋ Нове креслення</Link>
      <details><summary aria-label="Меню облікового запису" /><nav aria-label="Основна навігація">
        <Link href="/drawings">Мої креслення</Link>
        {navItems.map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        <LogoutButton />
      </nav></details>
    </div>
  </header>;

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
          <nav aria-label="Основна навігація" className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/drawings"
              className="inline-flex min-h-10 items-center rounded-sm px-2 text-sm font-medium text-[var(--bim-color-text-primary)] hover:bg-[var(--bim-color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
            >
              Мої креслення
            </Link>
            <Link
              href="/upload"
              className="inline-flex min-h-10 items-center rounded-sm px-2 text-sm font-medium text-[var(--bim-color-border-focus)] hover:bg-[var(--bim-color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
            >
              Завантажити
            </Link>
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex min-h-10 items-center rounded-sm px-2 text-sm font-medium hover:bg-[var(--bim-color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] ${
                    isActive
                      ? "text-[var(--bim-color-border-focus)]"
                      : "text-[var(--bim-color-text-primary)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <LogoutButton />
        </div>
      </PageContainer>
    </header>
  );
}
