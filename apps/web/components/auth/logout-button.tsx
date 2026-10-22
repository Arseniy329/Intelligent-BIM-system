"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignOut() {
    if (isLoading) return;

    setError("");
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setError("Не вдалося вийти з облікового запису. Спробуйте ще раз.");
        setIsLoading(false);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setError("Не вдалося вийти з облікового запису. Перевірте з’єднання та спробуйте ще раз.");
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isLoading}
        className="min-h-10 rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--bim-color-button-disabled-bg)] disabled:text-[var(--bim-color-button-disabled-text)]"
      >
        {isLoading ? "Виходимо…" : "Вийти"}
      </button>
      {error && (
        <p
          role="alert"
          className="max-w-xs rounded-lg border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-2 text-sm text-[var(--bim-color-semantic-error)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
