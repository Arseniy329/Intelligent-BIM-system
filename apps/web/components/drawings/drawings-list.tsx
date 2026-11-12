"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useDrawings } from "@/hooks/useDrawings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BadgeVariant =
  | "default"
  | "secondary"
  | "success"
  | "muted"
  | "destructive";

interface DrawingLike {
  id: string;
  filename: string;
  uploaded_at?: string | null;
  createdAt?: string | null;
  status: string;
  error_message?: string | null;
  has_result?: boolean;
}

export interface DrawingsListProps {
  drawings?: DrawingLike[];
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onOpen?: (id: string) => void;
}

interface StatusConfig {
  label: string;
  variant: BadgeVariant;
  className?: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  uploaded: {
    label: "Завантажено",
    variant: "secondary",
  },
  processing: {
    label: "Обробка",
    variant: "secondary",
    className:
      "border-[var(--bim-color-border-default)] bg-transparent text-[var(--bim-color-text-secondary)]",
  },
  processed: {
    label: "Готово",
    variant: "success",
  },
  failed: {
    label: "Помилка обробки",
    variant: "destructive",
  },
  pending: {
    label: "Очікує",
    variant: "secondary",
  },
  done: {
    label: "Готово",
    variant: "success",
  },
  error: {
    label: "Помилка обробки",
    variant: "destructive",
  },
};

const DEFAULT_STATUS: StatusConfig = {
  label: "Завантажено",
  variant: "secondary",
};

export function DrawingStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? DEFAULT_STATUS;

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}

export function formatUkrainianDate(value?: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium" }).format(
    date,
  );
}

interface DrawingRow {
  id: string;
  filename: string;
  uploadedAt: string;
  status: string;
  errorMessage: string | null;
  hasResult: boolean | undefined;
}

function toRow(drawing: DrawingLike): DrawingRow {
  return {
    id: drawing.id,
    filename: drawing.filename,
    uploadedAt: drawing.uploaded_at ?? drawing.createdAt ?? "",
    status: drawing.status,
    errorMessage: drawing.error_message ?? null,
    hasResult: drawing.has_result,
  };
}

function sortNewestFirst(rows: DrawingRow[]): DrawingRow[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      time: Date.parse(row.uploadedAt),
    }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.time);
      const bValid = Number.isFinite(b.time);

      if (aValid && bValid && a.time !== b.time) {
        return b.time - a.time;
      }
      if (aValid !== bValid) {
        return aValid ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

function isActionDisabled(row: DrawingRow): boolean {
  return (
    row.status === "processing" ||
    (row.status === "processing" && row.hasResult === false)
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-[var(--bim-shadow-sm)]">
      {children}
    </div>
  );
}

function DrawingsLoadingSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Завантаження списку креслень…</span>
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Файл</TableHead>
              <TableHead>Завантажено</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Дія</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2].map((index) => (
              <TableRow key={index}>
                <TableCell>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-24 rounded-[var(--bim-radius-full)]" />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Skeleton className="h-9 w-24" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>
    </div>
  );
}

function DrawingsErrorAlert({
  error,
  onRefresh,
}: {
  error: string;
  onRefresh?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-[var(--bim-spacing-6)] shadow-[var(--bim-shadow-sm)]"
    >
      <h2 className="text-base font-semibold text-[var(--bim-color-text-primary)]">
        Не вдалося завантажити список креслень
      </h2>
      <p className="mt-[var(--bim-spacing-2)] text-sm text-[var(--bim-color-text-secondary)]">
        {error}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={onRefresh}
        className="mt-[var(--bim-spacing-4)]"
      >
        Спробувати ще раз
      </Button>
    </div>
  );
}

function DrawingsListView({
  drawings,
  isLoading,
  error,
  onRefresh,
  onOpen,
}: {
  drawings: DrawingLike[];
  isLoading: boolean;
  error: string | null;
  onRefresh?: () => void;
  onOpen?: (id: string) => void;
}) {
  const router = useRouter();

  if (isLoading) {
    return <DrawingsLoadingSkeleton />;
  }

  if (error) {
    return <DrawingsErrorAlert error={error} onRefresh={onRefresh} />;
  }

  const rows = sortNewestFirst(drawings.map(toRow));

  if (rows.length === 0) {
    return (
      <EmptyState
        title="У вас ще немає креслень"
        description="Завантажте перше DXF-креслення, щоб почати розпізнавання приміщень та розстановку пожежних пристроїв."
        action={
          <Button asChild>
            <Link href="/upload">Завантажити DXF</Link>
          </Button>
        }
      />
    );
  }

  const handleRowClick = (
    event: MouseEvent<HTMLTableRowElement>,
    row: DrawingRow,
  ) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button")) {
      return;
    }

    if (onOpen) {
      onOpen(row.id);
      return;
    }

    router.push(`/drawings/${row.id}`);
  };

  return (
    <TableShell>
      <Table aria-label="Список креслень">
        <TableHeader>
          <TableRow>
            <TableHead>Файл</TableHead>
            <TableHead>Завантажено</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead className="text-right">Дія</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const actionDisabled = isActionDisabled(row);

            return (
              <TableRow
                key={row.id}
                data-testid="drawing-row"
                data-status={row.status}
                onClick={(event) => handleRowClick(event, row)}
                className="cursor-pointer"
              >
                <TableCell className="max-w-[22rem]">
                  <Link
                    href={`/drawings/${row.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="block break-all font-medium text-[var(--bim-color-text-primary)] hover:underline"
                  >
                    {row.filename}
                  </Link>
                </TableCell>
                <TableCell>
                  <time
                    dateTime={row.uploadedAt}
                    className="text-sm text-[var(--bim-color-text-secondary)]"
                  >
                    {formatUkrainianDate(row.uploadedAt)}
                  </time>
                </TableCell>
                <TableCell>
                  <DrawingStatusBadge status={row.status} />
                  {row.status === "failed" && row.errorMessage ? (
                    <span
                      className="mt-1 block text-xs text-[var(--bim-color-text-secondary)]"
                      title={row.errorMessage}
                    >
                      {row.errorMessage}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {actionDisabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled
                      title="Результат ще не готовий"
                    >
                      Відкрити
                      <span className="sr-only"> Результат ще не готовий</span>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/drawings/${row.id}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        Відкрити
                      </Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableShell>
  );
}

function ConnectedDrawingsList({
  onOpen,
}: {
  onOpen?: (id: string) => void;
}) {
  const { drawings, isLoading, error, refresh } = useDrawings();

  return (
    <DrawingsListView
      drawings={drawings}
      isLoading={isLoading}
      error={error}
      onRefresh={refresh}
      onOpen={onOpen}
    />
  );
}

export function DrawingsList({
  drawings,
  isLoading,
  error,
  onRefresh,
  onOpen,
}: DrawingsListProps = {}) {
  const hasProvidedData =
    drawings !== undefined || isLoading !== undefined || error !== undefined;

  if (hasProvidedData) {
    return (
      <DrawingsListView
        drawings={drawings ?? []}
        isLoading={isLoading ?? false}
        error={error ?? null}
        onRefresh={onRefresh}
        onOpen={onOpen}
      />
    );
  }

  return <ConnectedDrawingsList onOpen={onOpen} />;
}

export default DrawingsList;
