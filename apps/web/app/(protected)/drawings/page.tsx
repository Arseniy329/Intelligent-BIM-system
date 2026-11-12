"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DrawingsList } from "@/components/drawings/drawings-list";
import { useDrawings } from "@/hooks/useDrawings";

export default function DrawingsPage() {
  const router = useRouter();
  const { drawings, isLoading, error, reload } = useDrawings();

  return (
    <div className="space-y-[var(--bim-spacing-6)]">
      <div className="flex flex-col gap-[var(--bim-spacing-4)] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
            Мої креслення
          </h1>
          <p className="mt-[var(--bim-spacing-2)] text-sm text-[var(--bim-color-text-secondary)]">
            Список завантажених DXF-креслень та стан їхньої обробки.
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex min-h-[var(--bim-size-control-md)] shrink-0 items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-brand-on-primary)] hover:bg-[var(--bim-color-brand-primary-hover)] active:bg-[var(--bim-color-brand-primary-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
        >
          Завантажити DXF
        </Link>
      </div>

      <DrawingsList
        drawings={drawings}
        isLoading={isLoading}
        error={error}
        onOpen={(id) => router.push(`/drawings/${id}`)}
      />

      {error ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={reload}
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
          >
            Спробувати знову
          </button>
        </div>
      ) : null}
    </div>
  );
}
