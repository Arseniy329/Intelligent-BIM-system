import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--bim-radius-md)] text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-on-primary)] hover:bg-[var(--bim-color-brand-primary-hover)] active:bg-[var(--bim-color-brand-primary-pressed)]",
        destructive:
          "bg-[var(--bim-color-button-danger-bg)] text-[var(--bim-color-button-danger-text)] hover:opacity-90",
        outline:
          "border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)]",
        ghost:
          "text-[var(--bim-color-text-primary)] hover:bg-[var(--bim-color-surface-subtle)]",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-9 px-3 py-1.5 text-xs",
        lg: "min-h-11 px-6",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
