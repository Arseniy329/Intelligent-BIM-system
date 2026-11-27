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
    <Component className={cn("mx-auto w-full max-w-[1440px] px-4 sm:px-10", className)}>
      {children}
    </Component>
  );
}
