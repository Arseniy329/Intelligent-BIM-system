"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { useCurrentUserQuery } from "@/hooks/useCurrentUser";
import { ApiAuthenticationError, ApiHttpError } from "@/lib/api";

export interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * Route guard component for /admin routes.
 * Enforces Role-Based Access Control (RBAC):
 * - loading: shows accessible spinner (prevents FOUC).
 * - unauthenticated: redirects to /login with redirect query param.
 * - engineer (non-admin): displays dedicated 403 Forbidden screen.
 * - admin: renders children.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: user, isLoading, isError, error, refetch } = useCurrentUserQuery();

  const isUnauthenticated =
    isError &&
    (error instanceof ApiAuthenticationError ||
      (error instanceof ApiHttpError && error.statusCode === 401));

  useEffect(() => {
    if (isUnauthenticated) {
      const redirectParam = pathname
        ? `?redirect=${encodeURIComponent(pathname)}`
        : "";
      router.replace(`/login${redirectParam}`);
    }
  }, [isUnauthenticated, pathname, router]);

  // 1. Loading state (Guarantees NO FOUC)
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex min-h-[360px] flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <Loader2
          className="size-8 animate-spin text-[var(--bim-color-brand-primary)]"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-[var(--bim-color-text-secondary)]">
          Перевірка прав доступу…
        </span>
      </div>
    );
  }

  // 2. Unauthenticated state (Redirecting to login; prevents FOUC)
  if (isUnauthenticated) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex min-h-[360px] flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <Loader2
          className="size-8 animate-spin text-[var(--bim-color-brand-primary)]"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-[var(--bim-color-text-secondary)]">
          Перенаправлення на сторінку входу…
        </span>
      </div>
    );
  }

  // 3. Other API error state (e.g. 500 or network failure)
  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto my-8 flex max-w-md flex-col items-center justify-center rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-6 text-center text-[var(--bim-color-semantic-error)] shadow-[var(--bim-shadow-sm)]"
      >
        <AlertTriangle className="size-6 shrink-0" aria-hidden="true" />
        <h2 className="mt-2 text-base font-semibold">Помилка автентифікації</h2>
        <p className="mt-1 text-xs text-[var(--bim-color-text-secondary)]">
          {error?.message || "Не вдалося перевірити сеанс користувача."}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 text-xs font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)]"
        >
          Повторити спробу
        </button>
      </div>
    );
  }

  // 4. Authenticated, but role is NOT 'admin' (e.g. 'engineer') -> 403 Forbidden screen
  if (!user || user.role !== "admin") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="mx-auto my-8 flex max-w-lg flex-col items-center justify-center rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-surface-default)] p-8 text-center shadow-[var(--bim-shadow-sm)]"
      >
        <div className="flex size-14 items-center justify-center rounded-full bg-[var(--bim-color-semantic-error-bg)] text-[var(--bim-color-semantic-error)]">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-[var(--bim-color-text-primary)]">
          403 — Доступ заборонено
        </h1>
        <p className="mt-2 text-sm text-[var(--bim-color-text-secondary)]">
          Доступ заборонено. Потрібні права адміністратора.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary)] px-5 text-sm font-medium text-[var(--bim-color-brand-on-primary)] hover:bg-[var(--bim-color-brand-primary-hover)] active:bg-[var(--bim-color-brand-primary-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
          >
            Повернутися на головну
          </Link>
          <Link
            href="/drawings"
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] px-5 text-sm font-medium text-[var(--bim-color-text-primary)] hover:bg-[var(--bim-color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
          >
            Мої креслення
          </Link>
        </div>
      </div>
    );
  }

  // 5. Authenticated && role === 'admin' -> Authorized
  return <>{children}</>;
}

