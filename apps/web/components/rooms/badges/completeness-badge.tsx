import * as React from "react";
import { cn } from "@/lib/utils";
import { isRoomDataComplete } from "@/types/rooms";
import type { Room, RoomCompletenessStatus } from "@/types/rooms";

export interface CompletenessBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  isComplete?: boolean;
  status?: RoomCompletenessStatus;
  room?: Room;
  short?: boolean;
  className?: string;
}

export function CompletenessBadge({
  isComplete: isCompleteProp,
  status,
  room,
  short = false,
  className,
  ...props
}: CompletenessBadgeProps) {
  const isComplete =
    isCompleteProp !== undefined
      ? isCompleteProp
      : status !== undefined
        ? status === "sufficient"
        : room !== undefined
          ? isRoomDataComplete(room)
          : false;

  const label = isComplete
    ? short
      ? "Достатньо"
      : "Достатньо даних"
    : "Недостатньо даних";

  return (
    <span
      role="status"
      data-slot="room-completeness-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        isComplete
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
        {isComplete ? "✓" : "?"}
      </span>
      <span data-slot="badge-label">{label}</span>
    </span>
  );
}

export const RoomCompletenessBadge = CompletenessBadge;

