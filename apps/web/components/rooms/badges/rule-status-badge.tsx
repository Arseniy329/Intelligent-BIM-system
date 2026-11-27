import * as React from "react";
import { cn } from "@/lib/utils";
import type { RuleVerificationStatus } from "@/types/rooms";

export interface RuleStatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  status: RuleVerificationStatus;
  reason?: string | null;
  className?: string;
}

export function RuleStatusBadge({
  status,
  reason,
  className,
  ...props
}: RuleStatusBadgeProps) {
  const isVerified = status === "verified";
  const isInsufficient = status === "insufficient_data";
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  const hasReason = trimmedReason.length > 0;
  const reasonId = React.useId();

  const label = isVerified
    ? "Перевірено"
    : isInsufficient
      ? "Недостатньо даних"
      : "Треба перевірити";
  const icon = isVerified ? "✓" : isInsufficient ? "!" : "?";
  const ariaLabel = isInsufficient && hasReason ? `${label}: ${trimmedReason}` : undefined;

  return (
<<<<<<< HEAD
    <span className="inline-flex flex-col items-start gap-0.5">
=======
    <span
      role="status"
      data-slot="rule-status-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        isVerified
          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
          : "bg-amber-50 text-amber-800 border border-amber-200",
        className
      )}
      {...props}
    >
>>>>>>> origin/dev
      <span
        role="status"
        data-slot="rule-status-badge"
        aria-label={ariaLabel}
        aria-describedby={hasReason ? reasonId : undefined}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
          isVerified
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
            : isInsufficient
              ? "bg-slate-100 text-slate-700 border border-slate-300"
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
          {icon}
        </span>
        <span data-slot="badge-label">{label}</span>
      </span>
      {hasReason && (
        <span
          id={reasonId}
          data-slot="rule-status-reason"
          title={trimmedReason}
          className="line-clamp-2 max-w-[16rem] text-xs text-slate-500"
        >
          {trimmedReason}
        </span>
      )}
    </span>
  );
}
