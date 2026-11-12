"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRules, type Rule } from "@/lib/api/rules";
import { RulesTable } from "@/components/rules/rules-table";
import { NormsLookupForm } from "@/components/rules/norms-lookup-form";

function getRulesErrorMessage(loadError: unknown): string {
  return loadError instanceof Error && loadError.message
    ? loadError.message
    : "Не вдалося завантажити правила. Спробуйте ще раз.";
}

export default function RulesPage() {
  const { data, isLoading, error, refetch } = useQuery<Rule[]>({
    queryKey: ["rules"],
    queryFn: ({ signal }) => fetchRules(signal),
  });

  return (
    <div className="space-y-[var(--bim-spacing-6)]">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
          Правила й норми
        </h1>
        <p className="mt-[var(--bim-spacing-2)] text-sm text-[var(--bim-color-text-secondary)]">
          Правила базуються на чинних українських нормах, а відповіді
          перевіряються інженером.
        </p>
      </div>

      <section>
        <RulesTable
          rules={data ?? []}
          loading={isLoading}
          error={error ? getRulesErrorMessage(error) : null}
          onRetry={() => refetch()}
        />
      </section>

      <section>
        <NormsLookupForm />
      </section>
    </div>
  );
}
