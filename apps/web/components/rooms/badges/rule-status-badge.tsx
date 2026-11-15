import * as React from "react";
import { cn } from "@/lib/utils";
import type { RuleVerificationStatus } from "@/types/rooms";

export interface RuleStatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  status: RuleVerificationStatus;
  className?: string;
}

export function RuleStatusBadge({
  status,
  className,
  ...props
}: RuleStatusBadgeProps) {
  const isVerified = status === "verified";

  return (
    <span
      role="status"
      data-slot="rule-status-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        isVerified
          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
          : "bg-amber-50 text-amber-800 border border-amber-200",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="badge-icon"
        className="font-semibold leading-none"
      >
        {isVerified ? "✓" : "?"}
      </span>
      <span data-slot="badge-label">
        {isVerified ? "Перевірено" : "Треба перевірити"}
      </span>
    </span>
  );
}

