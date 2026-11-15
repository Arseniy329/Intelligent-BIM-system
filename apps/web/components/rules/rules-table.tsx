"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Rule } from "@/lib/api/rules";

const ALL_STATUSES = "__all__";

const STATUS_LABELS: Record<string, string> = {
  verified: "Перевірено",
  needs_verification: "Треба перевірити",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "verified") {
    return <Badge variant="success">Перевірено</Badge>;
  }
  if (status === "needs_verification") {
    return (
      <Badge className="border-[var(--bim-color-semantic-warning-border)] bg-[var(--bim-color-badge-warning-bg)] text-[var(--bim-color-badge-warning-text)]">
        Треба перевірити
      </Badge>
    );
  }
  return <Badge variant="muted">{status || "—"}</Badge>;
}

function formatHeight(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

function formatConditions(rule: Rule): string {
  const parts: string[] = [];

  if (rule.room_type) {
    parts.push(rule.room_type);
  }

  const min = formatHeight(rule.room_height_min);
  const max = formatHeight(rule.room_height_max);

  if (min && max) {
    parts.push(`від ${min} до ${max} м`);
  } else if (max) {
    parts.push(`≤ ${max} м`);
  } else if (min) {
    parts.push(`≥ ${min} м`);
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatCheckedAt(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("uk-UA").format(date);
}

export interface RulesTableProps {
  rules: Rule[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function RulesTable({
  rules,
  loading = false,
  error = null,
  onRetry,
}: RulesTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);

  const statuses = useMemo(() => {
    const seen = new Set<string>();
    for (const rule of rules) {
      if (rule.status) {
        seen.add(rule.status);
      }
    }
    return Array.from(seen);
  }, [rules]);

  const filteredRules = useMemo(() => {
    if (statusFilter === ALL_STATUSES) {
      return rules;
    }
    return rules.filter((rule) => rule.status === statusFilter);
  }, [rules, statusFilter]);

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 text-center text-sm text-[var(--bim-color-text-secondary)] shadow-[var(--bim-shadow-sm)]"
      >
        Завантаження правил...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-6 text-center text-[var(--bim-color-semantic-error)] shadow-[var(--bim-shadow-sm)]"
      >
        <AlertCircle className="mx-auto size-7" aria-hidden="true" />
        <p className="mt-2 text-sm">{error}</p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-4"
          >
            Повторити
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-[var(--bim-shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--bim-color-border-default)] p-4">
        <span className="text-sm font-medium text-[var(--bim-color-text-primary)]">
          Фільтр за статусом
        </span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            aria-label="Фільтр правил за статусом"
            className="w-full sm:w-56"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>Усі</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredRules.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--bim-color-text-secondary)]">
          Немає правил із цим статусом
        </p>
      ) : (
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Правило</TableHead>
              <TableHead>Значення</TableHead>
              <TableHead>Умови</TableHead>
              <TableHead>Документ</TableHead>
              <TableHead>Пункт</TableHead>
              <TableHead>Посилання</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Дата перевірки</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium text-[var(--bim-color-text-primary)]">
                  {rule.rule || "—"}
                </TableCell>
                <TableCell>{rule.value || "—"}</TableCell>
                <TableCell className="text-[var(--bim-color-text-secondary)]">
                  {formatConditions(rule)}
                </TableCell>
                <TableCell>{rule.document || "—"}</TableCell>
                <TableCell>{rule.clause || "—"}</TableCell>
                <TableCell>
                  {rule.link ? (
                    <a
                      href={rule.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--bim-color-brand-primary)] underline underline-offset-2 hover:opacity-80"
                    >
                      Відкрити
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={rule.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-[var(--bim-color-text-secondary)]">
                  {formatCheckedAt(rule.checked_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
