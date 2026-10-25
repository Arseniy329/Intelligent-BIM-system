import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "w-full min-w-0 rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-[var(--bim-spacing-6)] text-center sm:p-[var(--bim-spacing-8)]",
        className,
      )}
    >
      <h2 className="break-words text-xl font-semibold text-[var(--bim-color-text-primary)]">
        {title}
      </h2>
      <p className="mx-auto mt-[var(--bim-spacing-3)] max-w-prose break-words text-sm text-[var(--bim-color-text-secondary)]">
        {description}
      </p>
      {action && (
        <div className="mt-[var(--bim-spacing-6)] flex min-w-0 flex-wrap justify-center gap-[var(--bim-spacing-3)]">
          {action}
        </div>
      )}
    </section>
  );
}
