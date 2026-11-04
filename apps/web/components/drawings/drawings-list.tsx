"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
} from "lucide-react";
import type { DrawingUiStatus, NormalizedDrawingRecord } from "@/lib/api";
import { listDrawings } from "@/lib/api";
import { EmptyState } from "@/components/ui/empty-state";

interface StatusConfig {
  label: string;
  className: string;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
}

const STATUS_CONFIGS: Record<DrawingUiStatus, StatusConfig> = {
  pending: {
    label: "Очікує",
    className:
      "border-[var(--bim-color-border-default)] bg-[var(--bim-color-badge-neutral-bg)] text-[var(--bim-color-badge-neutral-text)]",
    icon: Clock,
  },
  uploaded: {
    label: "Завантажено",
    className:
      "border-[var(--bim-color-semantic-info-border)] bg-[var(--bim-color-badge-info-bg)] text-[var(--bim-color-badge-info-text)]",
    icon: CheckCircle2,
  },
  processing: {
    label: "В обробці",
    className:
      "border-[var(--bim-color-semantic-warning-border)] bg-[var(--bim-color-badge-warning-bg)] text-[var(--bim-color-badge-warning-text)]",
    icon: Loader2,
  },
  processed: {
    label: "Оброблено",
    className:
      "border-[var(--bim-color-semantic-success-border)] bg-[var(--bim-color-badge-success-bg)] text-[var(--bim-color-badge-success-text)]",
    icon: CheckCircle2,
  },
  failed: {
    label: "Помилка",
    className:
      "border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-badge-error-bg)] text-[var(--bim-color-badge-error-text)]",
    icon: AlertCircle,
  },
  error: {
    label: "Помилка",
    className:
      "border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-badge-error-bg)] text-[var(--bim-color-badge-error-text)]",
    icon: AlertCircle,
  },
};

export function DrawingStatusBadge({ status }: { status: DrawingUiStatus }) {
  const config = STATUS_CONFIGS[status] ?? {
    label: String(status),
    className:
      "border-[var(--bim-color-border-default)] bg-[var(--bim-color-badge-neutral-bg)] text-[var(--bim-color-badge-neutral-text)]",
    icon: FileText,
  };
  const Icon = config.icon;
  const isSpinning = status === "processing";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--bim-radius-full)] border px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      <Icon
        className={`size-3.5 shrink-0 ${isSpinning ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      <span>{config.label}</span>
    </span>
  );
}

export function formatUkrainianDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return isoString;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message.includes("401") ||
      error.message.includes("403") ||
      error.name === "ApiAuthenticationError"
    ) {
      return "Сеанс завершився або немає доступу. Будь ласка, увійдіть у систему знову.";
    }
    if (
      error.message.includes("Failed to fetch") ||
      error.name === "TypeError"
    ) {
      return "Помилка мережі під час звернення до сервера. Перевірте підключення до інтернету.";
    }
    if (error.message) {
      return error.message;
    }
  }
  return "Не вдалося отримати список ваших креслень. Спробуйте оновити сторінку або скористайтеся кнопкою повтору.";
}

function DrawingsLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-[var(--bim-spacing-4)]"
    >
      <span className="sr-only">Завантаження списку креслень…</span>
      <div className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-[var(--bim-spacing-6)] shadow-[var(--bim-shadow-sm)]">
        <div className="space-y-4 animate-pulse">
          <div className="h-5 w-48 rounded-[var(--bim-radius-sm)] bg-[var(--bim-color-surface-subtle)]" />
          <div className="h-10 w-full rounded-[var(--bim-radius-md)] bg-[var(--bim-color-surface-subtle)]" />
          <div className="h-10 w-full rounded-[var(--bim-radius-md)] bg-[var(--bim-color-surface-subtle)]" />
          <div className="h-10 w-full rounded-[var(--bim-radius-md)] bg-[var(--bim-color-surface-subtle)]" />
        </div>
      </div>
    </div>
  );
}

function DrawingsErrorAlert({
  error,
  onRetry,
  isRetrying,
}: {
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-[var(--bim-spacing-6)] text-[var(--bim-color-semantic-error)] shadow-[var(--bim-shadow-sm)]"
    >
      <div className="flex items-start gap-[var(--bim-spacing-3)]">
        <AlertCircle className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold">
            Не вдалося завантажити список креслень
          </h2>
          <p className="mt-1 text-sm text-[var(--bim-color-text-secondary)]">
            {getErrorMessage(error)}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="mt-[var(--bim-spacing-4)] inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors disabled:opacity-50"
          >
            {isRetrying ? "Оновлення…" : "Спробувати знову"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DrawingsList() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    NormalizedDrawingRecord[]
  >({
    queryKey: ["drawings"],
    queryFn: ({ signal }) => listDrawings(signal),
  });

  if (isLoading) {
    return <DrawingsLoadingSkeleton />;
  }

  if (isError) {
    return (
      <DrawingsErrorAlert
        error={error}
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  const drawings = data ?? [];

  if (drawings.length === 0) {
    return (
      <EmptyState
        title="У вас ще немає креслень"
        description="Поки що немає збережених DXF-креслень. Завантажте перше креслення для розпізнавання приміщень та розстановки пожежних пристроїв."
        action={
          <Link
            href="/upload"
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-brand-on-primary)] hover:bg-[var(--bim-color-brand-primary-hover)] active:bg-[var(--bim-color-brand-primary-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
          >
            Завантажити креслення
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-[var(--bim-spacing-4)]">
      {/* Mobile Card Layout (prevents horizontal overflow at 375px) */}
      <div
        className="flex flex-col gap-[var(--bim-spacing-3)] md:hidden"
        aria-label="Список креслень"
      >
        {drawings.map((drawing) => (
          <article
            key={drawing.id}
            className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-[var(--bim-spacing-4)] shadow-[var(--bim-shadow-sm)] flex flex-col gap-[var(--bim-spacing-3)]"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <FileText
                className="size-5 shrink-0 text-[var(--bim-color-brand-primary)] mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-[var(--bim-color-text-primary)] break-all">
                  {drawing.originalFileName}
                </p>
                <time
                  dateTime={drawing.createdAt}
                  className="mt-1 block text-xs text-[var(--bim-color-text-secondary)]"
                >
                  {formatUkrainianDate(drawing.createdAt)}
                </time>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--bim-color-table-divider)]">
              <DrawingStatusBadge status={drawing.status} />
              <Link
                href={`/drawings/${drawing.id}`}
                className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
              >
                Відкрити
              </Link>
            </div>
          </article>
        ))}
      </div>

      {/* Desktop Table Layout */}
      <div className="hidden md:block overflow-hidden rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-[var(--bim-shadow-sm)]">
        <table className="w-full text-left text-sm" aria-label="Список креслень">
          <thead className="border-b border-[var(--bim-color-table-divider)] bg-[var(--bim-color-table-header-bg)] text-xs font-semibold text-[var(--bim-color-table-header-text)]">
            <tr>
              <th scope="col" className="px-6 py-3.5">
                Назва файлу
              </th>
              <th scope="col" className="px-6 py-3.5">
                Дата створення
              </th>
              <th scope="col" className="px-6 py-3.5">
                Статус
              </th>
              <th scope="col" className="px-6 py-3.5 text-right">
                Дія
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--bim-color-table-divider)] bg-[var(--bim-color-table-row-bg)]">
            {drawings.map((drawing) => (
              <tr
                key={drawing.id}
                className="hover:bg-[var(--bim-color-table-row-hover-bg)] transition-colors"
              >
                <td className="px-6 py-4 font-medium text-[var(--bim-color-text-primary)]">
                  <div className="flex items-center gap-2.5">
                    <FileText
                      className="size-4 shrink-0 text-[var(--bim-color-brand-primary)]"
                      aria-hidden="true"
                    />
                    <span className="break-all">
                      {drawing.originalFileName}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-[var(--bim-color-text-secondary)]">
                  <time dateTime={drawing.createdAt}>
                    {formatUkrainianDate(drawing.createdAt)}
                  </time>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <DrawingStatusBadge status={drawing.status} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <Link
                    href={`/drawings/${drawing.id}`}
                    className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
                  >
                    Відкрити
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
