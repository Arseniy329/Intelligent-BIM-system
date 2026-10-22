import type { CSSProperties, ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import tokens from "../../../../tokens.json";

const authTokens = {
  "--bim-color-surface-page": tokens.color.surface.page,
  "--bim-color-surface-default": tokens.color.surface.default,
  "--bim-color-text-primary": tokens.color.text.primary,
  "--bim-color-text-secondary": tokens.color.text.secondary,
  "--bim-color-border-default": tokens.color.border.default,
  "--bim-color-border-focus": tokens.color.border.focus,
  "--bim-color-button-primary-bg": tokens.color.button.primaryBg,
  "--bim-color-button-primary-hover-bg": tokens.color.button.primaryHoverBg,
  "--bim-color-button-primary-pressed-bg": tokens.color.button.primaryPressedBg,
  "--bim-color-button-primary-text": tokens.color.button.primaryText,
  "--bim-color-button-disabled-bg": tokens.color.button.disabledBg,
  "--bim-color-button-disabled-text": tokens.color.button.disabledText,
  "--bim-color-input-bg": tokens.color.input.bg,
  "--bim-color-input-text": tokens.color.input.text,
  "--bim-color-input-border": tokens.color.input.border,
  "--bim-color-input-hover-border": tokens.color.input.hoverBorder,
  "--bim-color-input-focus-ring": tokens.color.input.focusRing,
  "--bim-color-input-error-border": tokens.color.input.errorBorder,
  "--bim-color-semantic-error": tokens.color.semantic.error,
  "--bim-color-semantic-error-bg": tokens.color.semantic.errorBg,
  "--bim-color-semantic-error-border": tokens.color.semantic.errorBorder,
  "--bim-color-semantic-success": tokens.color.semantic.success,
  "--bim-color-semantic-success-bg": tokens.color.semantic.successBg,
  "--bim-color-semantic-success-border": tokens.color.semantic.successBorder,
  "--bim-shadow-sm": tokens.shadow.sm,
  fontFamily: tokens.typography.fontFamily.base,
} as CSSProperties;

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (!error && data?.claims) {
    redirect("/upload");
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--bim-color-surface-page)] px-4 py-8 text-[var(--bim-color-text-primary)]"
      style={authTokens}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 shadow-[var(--bim-shadow-sm)] sm:p-8">
        {children}
      </div>
    </main>
  );
}
