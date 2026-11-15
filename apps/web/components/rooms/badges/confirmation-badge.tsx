import * as React from "react";
import { cn } from "@/lib/utils";
import type { Room, RoomConfirmationStatus } from "@/types/rooms";

export interface ConfirmationBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  isConfirmed?: boolean;
  status?: RoomConfirmationStatus;
  room?: Pick<Room, "isConfirmed" | "status">;
  className?: string;
}

export function ConfirmationBadge({
  isConfirmed: isConfirmedProp,
  status,
  room,
  className,
  ...props
}: ConfirmationBadgeProps) {
  const isConfirmed =
    isConfirmedProp !== undefined
      ? isConfirmedProp
      : status !== undefined
        ? status === "confirmed"
        : room?.isConfirmed !== undefined
          ? room.isConfirmed
          : room?.status === "confirmed";

  return (
    <span
      role="status"
      data-slot="room-confirmation-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        isConfirmed
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
        {isConfirmed ? "✓" : "!"}
      </span>
      <span data-slot="badge-label">
        {isConfirmed ? "Підтверджено" : "Не підтверджено"}
      </span>
    </span>
  );
}

export const RoomConfirmationBadge = ConfirmationBadge;

