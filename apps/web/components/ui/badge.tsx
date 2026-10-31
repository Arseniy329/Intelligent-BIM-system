import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit items-center justify-center gap-1 rounded-[var(--bim-radius-full)] border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-on-primary)]",
        secondary:
          "border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] text-[var(--bim-color-text-secondary)]",
        success:
          "border-[var(--bim-color-semantic-success-border)] bg-[var(--bim-color-badge-success-bg)] text-[var(--bim-color-badge-success-text)]",
        muted:
          "border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] text-[var(--bim-color-text-secondary)]",
        destructive:
          "border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] text-[var(--bim-color-semantic-error)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
