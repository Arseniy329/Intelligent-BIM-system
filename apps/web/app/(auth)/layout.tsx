import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (!error && data?.claims) {
    redirect("/upload");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bim-color-surface-page)] px-4 py-8 text-[var(--bim-color-text-primary)]">
      <div className="w-full max-w-md rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 shadow-[var(--bim-shadow-sm)] sm:p-8">
        {children}
      </div>
    </main>
  );
}
