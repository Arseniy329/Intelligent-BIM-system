"use client";

import { useState, type FormEvent } from "react";
import { lookupNorm, type NormLookupResponse } from "@/lib/api/rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NormsLookupFormProps {
  onResult?: (result: NormLookupResponse) => void;
}

function statusLabel(status: NormLookupResponse["status"]): string {
  if (status === "found_in_official_source") {
    return "Знайдено в офіційному джерелі";
  }
  if (status === "needs_verification") {
    return "Треба перевірити";
  }
  return status || "—";
}

function formatCheckedAt(value: string): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("uk-UA");
}

export function NormsLookupForm({ onResult }: NormsLookupFormProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NormLookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmedQuery = query.trim();
  const isSubmitDisabled = loading || trimmedQuery.length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    setResult(null);
    setError(null);
    setLoading(true);

    try {
      const response = await lookupNorm(trimmedQuery);
      setResult(response);
      onResult?.(response);
    } catch (lookupError) {
      setError(
        lookupError instanceof Error && lookupError.message
          ? lookupError.message
          : "Не вдалося виконати пошук норм. Спробуйте ще раз.",
      );
    } finally {
      setLoading(false);
    }
  }

  const needsVerification = result?.status === "needs_verification";

  return (
    <section className="space-y-4 rounded-[var(--bim-radius-lg)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[var(--bim-color-text-primary)]">
          Знайти вимогу в нормах
        </h2>
        <p className="text-sm text-[var(--bim-color-text-secondary)]">
          Відповідь перевіряє інженер
        </p>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="norms-lookup-query">Запит до агента норм</Label>
          <Input
            id="norms-lookup-query"
            name="query"
            value={query}
            placeholder="Опишіть вимогу або питання"
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading}
          />
        </div>
        <Button type="submit" disabled={isSubmitDisabled}>
          {loading ? "Пошук…" : "Знайти"}
        </Button>
      </form>

      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-[var(--bim-color-semantic-error)]"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <article
          aria-live="polite"
          className="space-y-3 rounded-[var(--bim-radius-md)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-4"
        >
          <dl className="space-y-2 text-sm">
            <div className="space-y-0.5">
              <dt className="font-semibold text-[var(--bim-color-text-primary)]">
                Документ
              </dt>
              <dd className="text-[var(--bim-color-text-secondary)]">
                {result.document || "—"}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-semibold text-[var(--bim-color-text-primary)]">
                Пункт
              </dt>
              <dd className="text-[var(--bim-color-text-secondary)]">
                {result.clause || "—"}
              </dd>
            </div>
            {result.sourceUrl ? (
              <div className="space-y-0.5">
                <dt className="font-semibold text-[var(--bim-color-text-primary)]">
                  Джерело
                </dt>
                <dd>
                  <a
                    href={result.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-[var(--bim-color-brand-primary)] underline underline-offset-2"
                  >
                    {result.sourceUrl}
                  </a>
                </dd>
              </div>
            ) : null}
            <div className="space-y-0.5">
              <dt className="font-semibold text-[var(--bim-color-text-primary)]">
                Статус
              </dt>
              <dd>
                <Badge
                  variant={
                    result.status === "found_in_official_source"
                      ? "success"
                      : "secondary"
                  }
                  className={
                    needsVerification
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : undefined
                  }
                >
                  {statusLabel(result.status)}
                </Badge>
              </dd>
            </div>
            {result.value !== null && result.value !== undefined ? (
              <div className="space-y-0.5">
                <dt className="font-semibold text-[var(--bim-color-text-primary)]">
                  Значення
                </dt>
                <dd className="text-[var(--bim-color-text-secondary)]">
                  {result.value}
                </dd>
              </div>
            ) : null}
            <div className="space-y-0.5">
              <dt className="font-semibold text-[var(--bim-color-text-primary)]">
                Перевірено
              </dt>
              <dd className="text-[var(--bim-color-text-secondary)]">
                {formatCheckedAt(result.checkedAt)}
              </dd>
            </div>
          </dl>

          {result.summary ? (
            <p className="text-sm text-[var(--bim-color-text-primary)]">
              {result.summary}
            </p>
          ) : null}

          {needsVerification ? (
            <p className="text-sm font-medium text-amber-800">
              Це не підтверджене порушення.
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
