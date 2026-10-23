import type { CSSProperties, ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import tokens from "../../../../tokens.json";

const protectedTokens = {
  "--bim-color-surface-page": tokens.color.surface.page,
  "--bim-color-surface-default": tokens.color.surface.default,
  "--bim-color-text-primary": tokens.color.text.primary,
  "--bim-color-text-secondary": tokens.color.text.secondary,
  "--bim-color-border-default": tokens.color.border.default,
  "--bim-color-border-focus": tokens.color.border.focus,
  "--bim-color-button-secondary-bg": tokens.color.button.secondaryBg,
  "--bim-color-button-secondary-hover-bg": tokens.color.button.secondaryHoverBg,
  "--bim-color-button-secondary-pressed-bg": tokens.color.button.secondaryPressedBg,
  "--bim-color-button-secondary-text": tokens.color.button.secondaryText,
  "--bim-color-button-secondary-border": tokens.color.button.secondaryBorder,
  "--bim-color-button-disabled-bg": tokens.color.button.disabledBg,
  "--bim-color-button-disabled-text": tokens.color.button.disabledText,
  "--bim-color-semantic-error": tokens.color.semantic.error,
  "--bim-color-semantic-error-bg": tokens.color.semantic.errorBg,
  "--bim-color-semantic-error-border": tokens.color.semantic.errorBorder,
  fontFamily: tokens.typography.fontFamily.base,
} as CSSProperties;

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  return (
    <div
      className="min-h-screen bg-[var(--bim-color-surface-page)] text-[var(--bim-color-text-primary)]"
      style={protectedTokens}
    >
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
