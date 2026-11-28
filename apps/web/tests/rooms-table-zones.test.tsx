// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RoomsTable } from "@/components/rooms/rooms-table";
import type { RoomWithZones } from "@/types/rooms";
import { DEFAULT_ROOM_TYPES } from "@/lib/rooms/room-types-api";

afterEach(() => {
  cleanup();
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

const baseRoom: RoomWithZones = {
  id: "room-101",
  number: "101",
  name: "Офіс 101",
  roomType: "office",
  height: null,
  area: 40,
  source: "auto",
  isConfirmed: true,
};

describe("RoomsTable per-zone rows with ceiling height (BIM-185)", () => {
  it("renders both zone names and their formatted ceiling heights", () => {
    const room: RoomWithZones = {
      ...baseRoom,
      zones: [
        { id: "zone-left", name: "Ліва", height: 3.2 },
        { id: "zone-right", name: "Права", height: 2.8 },
      ],
    };

    renderWithClient(
      <RoomsTable rooms={[room]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    expect(screen.getByText("↳ Ліва")).toBeInTheDocument();
    expect(screen.getByText("↳ Права")).toBeInTheDocument();
    expect(screen.getByText("3,2 м")).toBeInTheDocument();
    expect(screen.getByText("2,8 м")).toBeInTheDocument();
    expect(screen.getAllByTestId("room-zone-row")).toHaveLength(2);
  });

  it("renders the exact missing-data text when a zone has no ceiling height", () => {
    const room: RoomWithZones = {
      ...baseRoom,
      zones: [{ id: "zone-empty", name: "Без висоти", height: null }],
    };

    renderWithClient(
      <RoomsTable rooms={[room]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    const missing = screen.getByTestId("zone-height-missing");
    expect(missing).toHaveTextContent("недостатньо даних");
    expect(screen.getByText("недостатньо даних")).toBeInTheDocument();
  });

  it("renders no zone rows for a room without zones while keeping the room row", () => {
    const room: RoomWithZones = {
      ...baseRoom,
      id: "room-102",
      number: "102",
      name: "Коридор",
      height: 2.8,
      zones: undefined,
    };

    renderWithClient(
      <RoomsTable rooms={[room]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    expect(screen.queryAllByTestId("room-zone-row")).toHaveLength(0);
    expect(screen.getByText("102 · Коридор")).toBeInTheDocument();
  });
});
