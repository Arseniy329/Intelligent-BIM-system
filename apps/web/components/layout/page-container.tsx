import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageContainerProps = {
  as?: "div" | "main" | "section";
  children: ReactNode;
  className?: string;
};

export function PageContainer({
  as: Component = "div",
  children,
  className,
}: PageContainerProps) {
  return (
    <Component className={cn("mx-auto w-full max-w-5xl px-4 sm:px-6", className)}>
      {children}
    </Component>
  );
}
