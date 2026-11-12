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
import type { DrawingListItem, DrawingStatus } from "@/lib/drawing/drawing-api";
import { EmptyState } from "@/components/ui/empty-state";

export interface DrawingsListProps {
  drawings?: DrawingListItem[];
  isLoading?: boolean;
  error?: string | null;
  onOpen?: (id: string) => void;
}

type AnyDrawingStatus = DrawingUiStatus | DrawingStatus;
type StatusSource = "legacy" | "list";

interface StatusConfig {
  label: string;
  className: string;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
}

const LEGACY_STATUS_CONFIGS: Record<DrawingUiStatus, StatusConfig> = {
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

const LIST_STATUS_CONFIGS: Record<DrawingStatus, StatusConfig> = {
  pending: {
    label: "Очікує",
    className:
      "border-[var(--bim-color-border-default)] bg-[var(--bim-color-badge-neutral-bg)] text-[var(--bim-color-badge-neutral-text)]",
    icon: Clock,
  },
  processing: {
    label: "Обробка",
    className:
      "border-[var(--bim-color-semantic-warning-border)] bg-[var(--bim-color-badge-warning-bg)] text-[var(--bim-color-badge-warning-text)]",
    icon: Loader2,
  },
  done: {
    label: "Готово",
    className:
      "border-[var(--bim-color-semantic-success-border)] bg-[var(--bim-color-badge-success-bg)] text-[var(--bim-color-badge-success-text)]",
    icon: CheckCircle2,
  },
  error: {
    label: "Помилка обробки",
    className:
      "border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-badge-error-bg)] text-[var(--bim-color-badge-error-text)]",
    icon: AlertCircle,
  },
};

const FALLBACK_STATUS_CONFIG: StatusConfig = {
  label: "",
  className:
    "border-[var(--bim-color-border-default)] bg-[var(--bim-color-badge-neutral-bg)] text-[var(--bim-color-badge-neutral-text)]",
  icon: FileText,
};

export function DrawingStatusBadge({
  status,
  source = "legacy",
}: {
  status: AnyDrawingStatus;
  source?: StatusSource;
}) {
  const config =
    source === "list"
      ? LIST_STATUS_CONFIGS[status as DrawingStatus]
      : LEGACY_STATUS_CONFIGS[status as DrawingUiStatus];
  const resolved =
    config ??
    LIST_STATUS_CONFIGS[status as DrawingStatus] ??
    LEGACY_STATUS_CONFIGS[status as DrawingUiStatus] ??
    { ...FALLBACK_STATUS_CONFIG, label: String(status) };
  const Icon = resolved.icon;
  const isSpinning = status === "processing";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--bim-radius-full)] border px-2.5 py-0.5 text-xs font-medium ${resolved.className}`}
    >
      <Icon
        className={`size-3.5 shrink-0 ${isSpinning ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      <span>{resolved.label}</span>
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

interface DrawingRow {
  id: string;
  filename: string;
  createdAt: string;
  status: AnyDrawingStatus;
  source: StatusSource;
}

function isDrawingListItem(
  drawing: NormalizedDrawingRecord | DrawingListItem,
): drawing is DrawingListItem {
  return "filename" in drawing;
}

function toRow(
  drawing: NormalizedDrawingRecord | DrawingListItem,
): DrawingRow {
  if (isDrawingListItem(drawing)) {
    return {
      id: drawing.id,
      filename: drawing.filename,
      createdAt: drawing.createdAt,
      status: drawing.status,
      source: "list",
    };
  }

  return {
    id: drawing.id,
    filename: drawing.originalFileName,
    createdAt: drawing.createdAt,
    status: drawing.status,
    source: "legacy",
  };
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string" && error) {
    return error;
  }
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
  canRetry = true,
}: {
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
  canRetry?: boolean;
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
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="mt-[var(--bim-spacing-4)] inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors disabled:opacity-50"
            >
              {isRetrying ? "Оновлення…" : "Спробувати знову"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DrawingsList({
  drawings: providedDrawings,
  isLoading: providedIsLoading = false,
  error: providedError = null,
  onOpen,
}: DrawingsListProps = {}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    NormalizedDrawingRecord[]
  >({
    queryKey: ["drawings"],
    queryFn: ({ signal }) => listDrawings(signal),
    enabled: providedDrawings === undefined,
  });

  const usingProvidedDrawings = providedDrawings !== undefined;

  if (usingProvidedDrawings ? providedIsLoading : isLoading) {
    return <DrawingsLoadingSkeleton />;
  }

  if (usingProvidedDrawings ? Boolean(providedError) : isError) {
    return (
      <DrawingsErrorAlert
        error={usingProvidedDrawings ? providedError : error}
        onRetry={() => {
          if (!usingProvidedDrawings) {
            refetch();
          }
        }}
        isRetrying={usingProvidedDrawings ? false : isFetching}
        canRetry={!usingProvidedDrawings}
      />
    );
  }

  const rows = (providedDrawings ?? data ?? []).map(toRow);

  if (rows.length === 0) {
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
    <div
      className="overflow-hidden rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-[var(--bim-shadow-sm)]"
      aria-label="Список креслень"
    >
      <ul className="divide-y divide-[var(--bim-color-table-divider)]">
        {rows.map((drawing) => (
          <li key={drawing.id}>
            <Link
              href={`/drawings/${drawing.id}`}
              data-testid="drawing-row"
              data-status={drawing.status}
              onClick={
                onOpen
                  ? (event) => {
                      event.preventDefault();
                      onOpen(drawing.id);
                    }
                  : undefined
              }
              className="flex w-full items-center justify-between gap-[var(--bim-spacing-4)] px-[var(--bim-spacing-4)] py-[var(--bim-spacing-4)] text-left transition-colors hover:bg-[var(--bim-color-table-row-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--bim-color-border-focus)] sm:px-[var(--bim-spacing-6)]"
            >
              <span className="flex min-w-0 flex-1 items-center gap-[var(--bim-spacing-3)]">
                <FileText
                  className="size-5 shrink-0 text-[var(--bim-color-brand-primary)]"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block break-all text-sm font-medium text-[var(--bim-color-text-primary)]">
                    {drawing.filename}
                  </span>
                  <time
                    dateTime={drawing.createdAt}
                    className="mt-1 block text-xs text-[var(--bim-color-text-secondary)]"
                  >
                    {formatUkrainianDate(drawing.createdAt)}
                  </time>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-[var(--bim-spacing-3)]">
                <DrawingStatusBadge
                  status={drawing.status}
                  source={drawing.source}
                />
                <span className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] transition-colors group-hover:bg-[var(--bim-color-button-secondary-hover-bg)]">
                  Відкрити
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
