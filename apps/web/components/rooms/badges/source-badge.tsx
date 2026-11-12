import * as React from "react";
import { cn } from "@/lib/utils";
import type { Room, RoomSource } from "@/types/rooms";

export interface SourceBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  source?: RoomSource;
  room?: Pick<Room, "source">;
  className?: string;
}

export function SourceBadge({
  source: sourceProp,
  room,
  className,
  ...props
}: SourceBadgeProps) {
  const source = sourceProp ?? room?.source ?? "auto";
  const isManual = source === "manual";

  return (
    <span
      role="status"
      data-slot="room-source-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        isManual
          ? "bg-blue-50 text-blue-700 border border-blue-200"
          : "bg-slate-100 text-slate-700 border border-transparent",
        className
      )}
      {...props}
    >
      {isManual && (
        <span
          aria-hidden="true"
          data-slot="badge-icon"
          className="font-semibold leading-none"
        >
          ✎
        </span>
      )}
      <span data-slot="badge-label">
        {isManual ? "Обведено вручну" : "Автоматично"}
      </span>
    </span>
  );
}

export const RoomSourceBadge = SourceBadge;

