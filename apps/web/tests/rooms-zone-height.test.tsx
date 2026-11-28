// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { updateZoneMock } = vi.hoisted(() => ({
  updateZoneMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/drawing/plan-features-api", () => ({
  planFeaturesApi: { updateZone: updateZoneMock },
}));

import { RoomsTable } from "@/components/rooms/rooms-table";
import type { RoomWithZones } from "@/types/rooms";
import { DEFAULT_ROOM_TYPES } from "@/lib/rooms/room-types-api";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  updateZoneMock.mockClear();
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

function RoomsHarness({ initialRooms }: { initialRooms: RoomWithZones[] }) {
  const [rooms, setRooms] = React.useState(initialRooms);
  return (
    <RoomsTable
      rooms={rooms}
      roomTypes={DEFAULT_ROOM_TYPES}
      onZoneSaved={(savedZone, height) =>
        setRooms((previous) =>
          previous.map((room) => ({
            ...room,
            zones: room.zones?.map((zone) =>
              zone.id === savedZone.id ? { ...zone, height } : zone
            ),
          }))
        )
      }
    />
  );
}

const roomWithZones: RoomWithZones = {
  id: "room-101",
  number: "101",
  name: "Офіс 101",
  roomType: "office",
  height: null,
  area: 40,
  source: "auto",
  isConfirmed: true,
  zones: [
    { id: "zone-left", name: "Ліва", height: 3.2 },
    { id: "zone-right", name: "Права", height: null },
  ],
};

describe("RoomsTable zone ceiling heights (BIM-185)", () => {
  it("renders one labelled height input per zone with a missing-data fallback", () => {
    renderWithClient(
      <RoomsTable rooms={[roomWithZones]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    const leftInput = screen.getByLabelText("Висота зони Ліва у Офіс 101");
    const rightInput = screen.getByLabelText("Висота зони Права у Офіс 101");

    expect(leftInput).toBeInTheDocument();
    expect(rightInput).toBeInTheDocument();
    expect(leftInput).toHaveValue(3.2);
    expect(rightInput).toHaveValue(null);

    expect(screen.getByText("недостатньо даних")).toBeInTheDocument();
    expect(screen.getByText("↳ Ліва")).toBeInTheDocument();
    expect(screen.getByText("↳ Права")).toBeInTheDocument();
  });

  it("persists a valid zone height per zone on blur, not on every keystroke", async () => {
    renderWithClient(
      <RoomsTable rooms={[roomWithZones]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    const rightInput = screen.getByLabelText("Висота зони Права у Офіс 101");
    fireEvent.change(rightInput, { target: { value: "2.4" } });

    expect(updateZoneMock).not.toHaveBeenCalled();

    fireEvent.blur(rightInput);

    await waitFor(() =>
      expect(updateZoneMock).toHaveBeenCalledWith("zone-right", {
        name: "Права",
        height: 2.4,
      })
    );
    expect(updateZoneMock).toHaveBeenCalledTimes(1);
  });

  it("does not persist a partial value like \"2.\" on change or blur", () => {
    renderWithClient(
      <RoomsTable rooms={[roomWithZones]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    const rightInput = screen.getByLabelText("Висота зони Права у Офіс 101");
    fireEvent.change(rightInput, { target: { value: "2." } });

    expect(updateZoneMock).not.toHaveBeenCalled();

    fireEvent.blur(rightInput);

    expect(updateZoneMock).not.toHaveBeenCalled();
  });

  it("does not issue a request when committing an unchanged zone height", () => {
    renderWithClient(
      <RoomsTable rooms={[roomWithZones]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    const leftInput = screen.getByLabelText("Висота зони Ліва у Офіс 101");
    fireEvent.change(leftInput, { target: { value: "3.2" } });
    fireEvent.blur(leftInput);

    expect(updateZoneMock).not.toHaveBeenCalled();
  });

  it("marks the zone as filled after a successful save", async () => {
    renderWithClient(<RoomsHarness initialRooms={[roomWithZones]} />);

    const initialRow = screen
      .getByLabelText("Висота зони Права у Офіс 101")
      .closest("tr");
    expect(initialRow).not.toBeNull();
    expect(
      within(initialRow as HTMLElement).getByText("Висоту не задано")
    ).toBeInTheDocument();
    expect(
      within(initialRow as HTMLElement).getByText("недостатньо даних")
    ).toBeInTheDocument();

    const rightInput = screen.getByLabelText("Висота зони Права у Офіс 101");
    fireEvent.change(rightInput, { target: { value: "2.4" } });
    fireEvent.blur(rightInput);

    await waitFor(() =>
      expect(updateZoneMock).toHaveBeenCalledWith("zone-right", {
        name: "Права",
        height: 2.4,
      })
    );

    await waitFor(() => {
      const savedRow = screen
        .getByLabelText("Висота зони Права у Офіс 101")
        .closest("tr");
      expect(savedRow).not.toBeNull();
      expect(
        within(savedRow as HTMLElement).getByText("Висоту задано")
      ).toBeInTheDocument();
      expect(
        within(savedRow as HTMLElement).queryByText("недостатньо даних")
      ).not.toBeInTheDocument();
    });
  });

  it("shows inline validation and does not save invalid or negative heights", () => {
    renderWithClient(
      <RoomsTable rooms={[roomWithZones]} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    const rightInput = screen.getByLabelText("Висота зони Права у Офіс 101");
    fireEvent.change(rightInput, { target: { value: "-1" } });
    fireEvent.blur(rightInput);

    expect(
      screen.getByText("Вкажіть висоту числом, більшим за 0.")
    ).toBeInTheDocument();
    expect(updateZoneMock).not.toHaveBeenCalled();
  });

  it("renders rooms without zones without any child rows", () => {
    const roomWithoutZones: RoomWithZones = {
      ...roomWithZones,
      id: "room-102",
      number: "102",
      name: "Коридор",
      height: 2.8,
      zones: undefined,
    };

    renderWithClient(
      <RoomsTable
        rooms={[roomWithoutZones]}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    expect(screen.getByText("102 · Коридор")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Висота зони/u)
    ).not.toBeInTheDocument();
  });
});
