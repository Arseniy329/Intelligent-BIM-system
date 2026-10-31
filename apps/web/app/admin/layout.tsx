import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { AdminGuard } from "@/components/auth/admin-guard";
import { AppShell } from "@/components/layout/app-shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <AdminGuard>
        <div className="space-y-6">
          {/* Admin Header & Breadcrumbs */}
          <div className="space-y-2 border-b border-[var(--bim-color-border-default)] pb-4">
            <nav
              aria-label="Навігація адміністратора"
              className="flex items-center gap-1.5 text-xs text-[var(--bim-color-text-secondary)]"
            >
              <Link
                href="/"
                className="hover:text-[var(--bim-color-text-primary)] hover:underline"
              >
                Головна
              </Link>
              <ChevronRight className="size-3.5" aria-hidden="true" />
              <span className="font-medium text-[var(--bim-color-text-primary)]">
                Панель адміністратора
              </span>
              <ChevronRight className="size-3.5" aria-hidden="true" />
              <span className="text-[var(--bim-color-text-secondary)]">
                Керування користувачами
              </span>
            </nav>
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary-subtle)] text-[var(--bim-color-brand-primary)]">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-[var(--bim-color-text-primary)] sm:text-2xl">
                  Панель адміністратора
                </h1>
                <p className="text-xs text-[var(--bim-color-text-secondary)] sm:text-sm">
                  Керування користувачами та системними доступами
                </p>
              </div>
            </div>
          </div>

          {/* Admin Page Content */}
          <section>{children}</section>
        </div>
      </AdminGuard>
    </AppShell>
  );
}

