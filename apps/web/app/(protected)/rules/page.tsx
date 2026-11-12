"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchRules, type Rule } from "@/lib/api/rules";
import { RulesTable } from "@/components/rules/rules-table";
import { NormsLookupForm } from "@/components/rules/norms-lookup-form";

function getRulesErrorMessage(loadError: unknown): string {
  return loadError instanceof Error && loadError.message
    ? loadError.message
    : "Не вдалося завантажити правила. Спробуйте ще раз.";
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchRules();
      setRules(data);
    } catch (loadError) {
      setError(getRulesErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const data = await fetchRules(controller.signal);
        if (controller.signal.aborted) return;
        setRules(data);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(getRulesErrorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, []);

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
          rules={rules}
          loading={loading}
          error={error}
          onRetry={loadRules}
        />
      </section>

      <section>
        <NormsLookupForm />
      </section>
    </div>
  );
}
