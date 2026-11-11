// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import {
  isRoomDataComplete,
  getRoomBlockingReasons,
  getRoomCompletenessStatus,
  getRoomConfirmationStatus,
  BLOCKING_REASONS,
  type Room,
} from "@/types/rooms";
import {
  SourceBadge,
  ConfirmationBadge,
  CompletenessBadge,
  RuleStatusBadge,
} from "@/components/rooms/badges";

describe("Room State Triad - isRoomDataComplete", () => {
  const baseRoom: Room = {
    name: "Room 101",
    roomType: "office",
    height: 3.0,
    area: 25.0,
    source: "auto",
    isConfirmed: true,
  };

  it("returns true only when valid roomType and positive height (> 0) are present", () => {
    expect(isRoomDataComplete(baseRoom)).toBe(true);
    expect(isRoomDataComplete({ ...baseRoom, height: 2.7 })).toBe(true);
    expect(isRoomDataComplete({ ...baseRoom, roomType: "storage" })).toBe(true);
  });

  it("returns false when height is missing (null or undefined)", () => {
    expect(isRoomDataComplete({ ...baseRoom, height: null })).toBe(false);
    expect(
      isRoomDataComplete({
        ...baseRoom,
        height: undefined as unknown as null,
      })
    ).toBe(false);
  });

  it("returns false when height is zero or negative", () => {
    expect(isRoomDataComplete({ ...baseRoom, height: 0 })).toBe(false);
    expect(isRoomDataComplete({ ...baseRoom, height: -0.1 })).toBe(false);
    expect(isRoomDataComplete({ ...baseRoom, height: -3.5 })).toBe(false);
  });

  it("returns false when height is NaN or not finite", () => {
    expect(isRoomDataComplete({ ...baseRoom, height: Number.NaN })).toBe(false);
    expect(
      isRoomDataComplete({ ...baseRoom, height: Number.POSITIVE_INFINITY })
    ).toBe(false);
  });

  it("returns false when room type is null or undefined", () => {
    expect(isRoomDataComplete({ ...baseRoom, roomType: null })).toBe(false);
    expect(
      isRoomDataComplete({
        ...baseRoom,
        roomType: undefined as unknown as null,
      })
    ).toBe(false);
  });

  it("returns false when room type is empty string or only whitespace", () => {
    expect(isRoomDataComplete({ ...baseRoom, roomType: "" })).toBe(false);
    expect(isRoomDataComplete({ ...baseRoom, roomType: "   " })).toBe(false);
    expect(isRoomDataComplete({ ...baseRoom, roomType: "\t\n" })).toBe(false);
  });

  it("falls back to type field when roomType is not explicitly provided", () => {
    const legacyRoom: Room = {
      name: "Server",
      roomType: null,
      type: "server_room",
      height: 3.2,
      area: 12.0,
      source: "auto",
      isConfirmed: false,
    };
    // If roomType is null explicitly, it should be treated as null
    expect(isRoomDataComplete(legacyRoom)).toBe(false);

    // When roomType is undefined and type is valid
    const legacyRoom2 = {
      name: "Server",
      type: "server_room",
      height: 3.2,
      area: 12.0,
      source: "auto" as const,
      isConfirmed: false,
    } as unknown as Room;
    expect(isRoomDataComplete(legacyRoom2)).toBe(true);
  });

  it("correctly computes getRoomCompletenessStatus", () => {
    expect(getRoomCompletenessStatus(baseRoom)).toBe("sufficient");
    expect(
      getRoomCompletenessStatus({ ...baseRoom, height: null })
    ).toBe("insufficient");
  });

  it("correctly computes getRoomConfirmationStatus", () => {
    expect(getRoomConfirmationStatus(baseRoom)).toBe("confirmed");
    expect(
      getRoomConfirmationStatus({ ...baseRoom, isConfirmed: false })
    ).toBe("unconfirmed");
  });
});

describe("Room State Triad - getRoomBlockingReasons", () => {
  const completeConfirmedAutoRoom: Room = {
    name: "Room A",
    roomType: "office",
    height: 3.0,
    area: 20.0,
    source: "auto",
    isConfirmed: true,
  };

  it("returns empty array when all rooms are confirmed, complete, and have no unsaved changes", () => {
    const reasons = getRoomBlockingReasons([completeConfirmedAutoRoom]);
    expect(reasons).toEqual([]);
  });

  it("returns empty array for an empty rooms list when there are no unsaved changes", () => {
    expect(getRoomBlockingReasons([])).toEqual([]);
  });

  it("asserts that manually drawn rooms without confirmation are listed as unconfirmed", () => {
    const manualUnconfirmedRoom: Room = {
      name: "Manual Room",
      source: "manual",
      isConfirmed: false,
      roomType: "corridor",
      height: 2.8,
      area: 15.0,
    };

    const reasons = getRoomBlockingReasons([manualUnconfirmedRoom]);
    expect(reasons).toEqual([BLOCKING_REASONS.UNCONFIRMED_ROOMS]);
    expect(reasons).toContain("! Не підтверджено");
  });

  it("returns incomplete reason when room type or height is missing", () => {
    const missingHeightRoom: Room = {
      name: "Room Without Height",
      source: "auto",
      isConfirmed: true,
      roomType: "office",
      height: null,
      area: 18.0,
    };

    const missingTypeRoom: Room = {
      name: "Room Without Type",
      source: "auto",
      isConfirmed: true,
      roomType: null,
      height: 3.0,
      area: 18.0,
    };

    expect(getRoomBlockingReasons([missingHeightRoom])).toEqual([
      BLOCKING_REASONS.INCOMPLETE_DATA,
    ]);
    expect(getRoomBlockingReasons([missingTypeRoom])).toEqual([
      BLOCKING_REASONS.INCOMPLETE_DATA,
    ]);
    expect(getRoomBlockingReasons([missingHeightRoom])).toContain(
      "? Недостатньо даних"
    );
  });

  it("detects unsaved changes via options or room properties", () => {
    expect(
      getRoomBlockingReasons([completeConfirmedAutoRoom], {
        hasUnsavedChanges: true,
      })
    ).toEqual([BLOCKING_REASONS.UNSAVED_CHANGES]);

    expect(
      getRoomBlockingReasons([completeConfirmedAutoRoom], true)
    ).toEqual([BLOCKING_REASONS.UNSAVED_CHANGES]);

    const dirtyRoom: Room = {
      ...completeConfirmedAutoRoom,
      hasUnsavedChanges: true,
    };
    expect(getRoomBlockingReasons([dirtyRoom])).toEqual([
      BLOCKING_REASONS.UNSAVED_CHANGES,
    ]);
  });

  it("asserts that multiple reasons are preserved and not truncated in strict priority order", () => {
    const dirtyRoom: Room = {
      name: "Room 1",
      source: "manual",
      isConfirmed: false, // Reason 2: ! Не підтверджено
      roomType: null, // Reason 3: ? Недостатньо даних
      height: null,
      area: 25.0,
      hasUnsavedChanges: true, // Reason 1: Незбережені зміни
    };

    const reasons = getRoomBlockingReasons([dirtyRoom]);

    // Must preserve ALL reasons, not just the first one
    expect(reasons).toHaveLength(3);
    expect(reasons).toEqual([
      BLOCKING_REASONS.UNSAVED_CHANGES,
      BLOCKING_REASONS.UNCONFIRMED_ROOMS,
      BLOCKING_REASONS.INCOMPLETE_DATA,
    ]);
    expect(reasons[0]).toBe("Незбережені зміни");
    expect(reasons[1]).toBe("! Не підтверджено");
    expect(reasons[2]).toBe("? Недостатньо даних");
  });

  it("preserves unconfirmed and incomplete data reasons together in strict priority", () => {
    const unconfirmedRoom: Room = {
      name: "Room A",
      source: "auto",
      isConfirmed: false,
      roomType: "office",
      height: 3.0,
      area: 20.0,
    };

    const incompleteRoom: Room = {
      name: "Room B",
      source: "auto",
      isConfirmed: true,
      roomType: null,
      height: 2.8,
      area: 15.0,
    };

    const reasons = getRoomBlockingReasons([unconfirmedRoom, incompleteRoom]);
    expect(reasons).toEqual([
      BLOCKING_REASONS.UNCONFIRMED_ROOMS,
      BLOCKING_REASONS.INCOMPLETE_DATA,
    ]);
  });
});

describe("Status Badge Components (BIM-129 visual styles)", () => {
  describe("SourceBadge", () => {
    it("renders automatic badge with text 'Автоматично' and slate styling", () => {
      render(<SourceBadge source="auto" />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("Автоматично");
      expect(badge.className).toContain("bg-slate-100");
      expect(badge.className).toContain("text-slate-700");
      expect(badge.textContent).not.toContain("✎");
    });

    it("renders manual badge with icon ✎, text 'Обведено вручну', and blue styling", () => {
      render(<SourceBadge source="manual" />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("Обведено вручну");
      expect(badge).toHaveTextContent("✎");
      expect(badge.className).toContain("bg-blue-50");
      expect(badge.className).toContain("text-blue-700");
    });

    it("accepts room prop directly", () => {
      render(<SourceBadge room={{ source: "manual" }} />);
      expect(screen.getByRole("status")).toHaveTextContent("Обведено вручну");
    });
  });

  describe("ConfirmationBadge", () => {
    it("renders unconfirmed badge with icon !, text 'Не підтверджено', and amber styling", () => {
      render(<ConfirmationBadge isConfirmed={false} />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("!");
      expect(badge).toHaveTextContent("Не підтверджено");
      expect(badge.className).toContain("bg-amber-50");
      expect(badge.className).toContain("text-amber-800");
      expect(badge.className).toContain("border-amber-200");
    });

    it("renders confirmed badge with icon ✓, text 'Підтверджено', and emerald styling", () => {
      render(<ConfirmationBadge isConfirmed={true} />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("✓");
      expect(badge).toHaveTextContent("Підтверджено");
      expect(badge.className).toContain("bg-emerald-50");
      expect(badge.className).toContain("text-emerald-800");
      expect(badge.className).toContain("border-emerald-200");
    });

    it("accepts status prop 'unconfirmed' and 'confirmed'", () => {
      const { rerender } = render(<ConfirmationBadge status="unconfirmed" />);
      expect(screen.getByRole("status")).toHaveTextContent("Не підтверджено");

      rerender(<ConfirmationBadge status="confirmed" />);
      expect(screen.getByRole("status")).toHaveTextContent("Підтверджено");
    });

    it("accepts room prop directly", () => {
      render(<ConfirmationBadge room={{ isConfirmed: false }} />);
      expect(screen.getByRole("status")).toHaveTextContent("Не підтверджено");
    });
  });

  describe("CompletenessBadge", () => {
    it("renders insufficient badge with icon ?, text 'Недостатньо даних', and amber styling", () => {
      render(<CompletenessBadge isComplete={false} />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("?");
      expect(badge).toHaveTextContent("Недостатньо даних");
      expect(badge.className).toContain("bg-amber-50");
      expect(badge.className).toContain("text-amber-800");
    });

    it("renders sufficient badge with icon ✓, text 'Достатньо даних', and emerald styling", () => {
      render(<CompletenessBadge isComplete={true} />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("✓");
      expect(badge).toHaveTextContent("Достатньо даних");
      expect(badge.className).toContain("bg-emerald-50");
      expect(badge.className).toContain("text-emerald-800");
    });

    it("renders short sufficient text 'Достатньо' when short prop is true", () => {
      render(<CompletenessBadge isComplete={true} short />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("✓");
      expect(badge).toHaveTextContent("Достатньо");
      expect(badge).not.toHaveTextContent("Достатньо даних");
    });

    it("evaluates completeness dynamically from room prop", () => {
      const incompleteRoom: Room = {
        name: "Test Room",
        roomType: null,
        height: 3.0,
        area: 20.0,
        source: "auto",
        isConfirmed: true,
      };

      const { rerender } = render(<CompletenessBadge room={incompleteRoom} />);
      expect(screen.getByRole("status")).toHaveTextContent("Недостатньо даних");

      const completeRoom: Room = {
        ...incompleteRoom,
        roomType: "office",
      };
      rerender(<CompletenessBadge room={completeRoom} />);
      expect(screen.getByRole("status")).toHaveTextContent("Достатньо даних");
    });
  });

  describe("RuleStatusBadge", () => {
    it("renders review needed badge with icon ?, text 'Треба перевірити', and amber styling", () => {
      render(<RuleStatusBadge status="needs_review" />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("?");
      expect(badge).toHaveTextContent("Треба перевірити");
      expect(badge.className).toContain("bg-amber-50");
      expect(badge.className).toContain("text-amber-800");
    });

    it("renders verified badge with icon ✓, text 'Перевірено', and emerald styling", () => {
      render(<RuleStatusBadge status="verified" />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("✓");
      expect(badge).toHaveTextContent("Перевірено");
      expect(badge.className).toContain("bg-emerald-50");
      expect(badge.className).toContain("text-emerald-800");
      expect(badge.className).toContain("border-emerald-200");
    });
  });
});
