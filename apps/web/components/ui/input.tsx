import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full rounded-[var(--bim-radius-md)] border border-[var(--bim-color-input-border)] bg-[var(--bim-color-input-bg)] px-3 py-2 text-sm text-[var(--bim-color-input-text)] transition-colors placeholder:text-[var(--bim-color-input-placeholder)] hover:border-[var(--bim-color-input-hover-border)] focus-visible:border-[var(--bim-color-border-focus)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--bim-color-input-error-border)] aria-invalid:hover:border-[var(--bim-color-input-error-border)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

