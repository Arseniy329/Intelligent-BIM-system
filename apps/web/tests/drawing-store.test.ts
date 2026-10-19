import { afterEach, describe, expect, it } from "vitest";
import { useDrawingStore } from "@/store/use-drawing-store";

describe("drawing store", () => {
  afterEach(() => useDrawingStore.getState().reset());

  it("synchronizes the selected room", () => {
    useDrawingStore.getState().selectRoom("room-01");
    expect(useDrawingStore.getState().selectedRoomId).toBe("room-01");
  });
});
