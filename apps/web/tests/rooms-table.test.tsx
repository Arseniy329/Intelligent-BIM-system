// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RoomsTable } from "@/components/rooms/rooms-table";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import type { Room } from "@/types/rooms";
import { DEFAULT_ROOM_TYPES } from "@/lib/rooms/room-types-api";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";

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

describe("RoomsTable (layout 02-rooms)", () => {
  const mockRooms: Room[] = [
    {
      id: "r1",
      number: "101",
      name: "Кабінет директора",
      roomType: "office",
      height: 3.0,
      area: 24.5,
      source: "auto",
      isConfirmed: true,
    },
    {
      id: "r2",
      number: "102",
      name: "Коридор",
      roomType: "corridor",
      height: 2.8,
      area: 18.0,
      source: "auto",
      isConfirmed: false,
    },
    {
      id: "r3",
      number: "103",
      name: "Серверна",
      roomType: null,
      height: null,
      area: 12.0,
      source: "manual",
      isConfirmed: false,
    },
  ];

  it("renders sub-header title, column headers, and Ukrainian pluralized summary counts", () => {
    renderWithClient(
      <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    // Sub-header title
    expect(
      screen.getByRole("heading", { level: 2, name: "Приміщення" })
    ).toBeInTheDocument();

    // Pluralized summary: 3 приміщення · 2 не підтверджено · 1 з неповними даними
    const summary = screen.getByText(
      /3 приміщення · 2 не підтверджено · 1 з неповними даними/
    );
    expect(summary).toBeInTheDocument();

    // Table column headers
    expect(screen.getByRole("columnheader", { name: "Приміщення" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Тип" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Висота" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Джерело" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Підтвердження" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Дані" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Дія" })).toBeInTheDocument();

    // Table footer caption hint
    expect(
      screen.getByText("Клік по назві виділяє те саме приміщення на плані.")
    ).toBeInTheDocument();
  });

  it("displays room number and name correctly in Column 1", () => {
    renderWithClient(
      <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    expect(screen.getByText("101 · Кабінет директора")).toBeInTheDocument();
    expect(screen.getByText("102 · Коридор")).toBeInTheDocument();
    expect(screen.getByText("103 · Серверна")).toBeInTheDocument();
  });

  it("displays translated room types and renders amber 'Тип не визначено' for unassigned rooms", () => {
    renderWithClient(
      <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    // Translated types from catalog
    expect(screen.getByText("Офіс, кабінет")).toBeInTheDocument();
    expect(screen.getByText("Коридор, шлях евакуації")).toBeInTheDocument();

    // Amber warning for missing type
    const missingTypeEl = screen.getByText("Тип не визначено");
    expect(missingTypeEl).toBeInTheDocument();
    expect(missingTypeEl.className).toContain("bg-amber-50");
    expect(missingTypeEl.className).toContain("text-amber-800");
  });

  it("displays formatted height and renders amber 'Не вказано' when missing or zero", () => {
    renderWithClient(
      <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    // Formatted heights
    expect(screen.getByText("3,0 м")).toBeInTheDocument();
    expect(screen.getByText("2,8 м")).toBeInTheDocument();

    // Amber warning for missing height
    const missingHeightEl = screen.getByText("Не вказано");
    expect(missingHeightEl).toBeInTheDocument();
    expect(missingHeightEl.className).toContain("bg-amber-50");
    expect(missingHeightEl.className).toContain("text-amber-800");
  });

  it("renders appropriate status badges for each State Triad axis independently", () => {
    renderWithClient(
      <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    // Source badges
    const autoBadges = screen.getAllByText("Автоматично");
    expect(autoBadges.length).toBe(2);
    expect(screen.getByText("Обведено вручну")).toBeInTheDocument();

    // Confirmation badges
    expect(screen.getByText("Підтверджено")).toBeInTheDocument();
    const unconfirmedBadges = screen.getAllByText("Не підтверджено");
    expect(unconfirmedBadges.length).toBe(2);

    // Completeness badges
    const completeBadges = screen.getAllByText("Достатньо даних");
    expect(completeBadges.length).toBe(2);
    expect(screen.getByText("Недостатньо даних")).toBeInTheDocument();
  });

  it("renders contextual action buttons in Column 7 based on room status", () => {
    renderWithClient(
      <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
    );

    // Room 101 (Complete & Confirmed) -> "На плані"
    expect(screen.getByRole("button", { name: "На плані" })).toBeInTheDocument();

    // Room 102 (Complete & Unconfirmed) -> "Перевірити"
    expect(screen.getByRole("button", { name: "Перевірити" })).toBeInTheDocument();

    // Room 103 (Incomplete) -> "Заповнити"
    expect(screen.getByRole("button", { name: "Заповнити" })).toBeInTheDocument();
  });

  it("triggers selection and navigation callbacks when clicking room name", () => {
    const onSelectRoom = vi.fn();
    const onNavigateToPlan = vi.fn();

    renderWithClient(
      <RoomsTable
        rooms={mockRooms}
        roomTypes={DEFAULT_ROOM_TYPES}
        onSelectRoom={onSelectRoom}
        onNavigateToPlan={onNavigateToPlan}
      />
    );

    const roomButton = screen.getByText("101 · Кабінет директора");
    fireEvent.click(roomButton);

    expect(onSelectRoom).toHaveBeenCalledTimes(1);
    expect(onSelectRoom).toHaveBeenCalledWith(mockRooms[0]);
    expect(onNavigateToPlan).toHaveBeenCalledTimes(1);
    expect(onNavigateToPlan).toHaveBeenCalledWith(mockRooms[0]);
  });

  it("triggers edit callback when clicking 'Заповнити'", () => {
    const onEditRoom = vi.fn();

    renderWithClient(
      <RoomsTable
        rooms={mockRooms}
        roomTypes={DEFAULT_ROOM_TYPES}
        onEditRoom={onEditRoom}
      />
    );

    const fillButton = screen.getByRole("button", { name: "Заповнити" });
    fireEvent.click(fillButton);

    expect(onEditRoom).toHaveBeenCalledTimes(1);
    expect(onEditRoom).toHaveBeenCalledWith(mockRooms[2]);
  });

  describe("Bottom Blocking Banner (02-rooms)", () => {
    it("renders soft amber warning banner when there are unconfirmed or incomplete rooms", () => {
      renderWithClient(
        <RoomsTable rooms={mockRooms} roomTypes={DEFAULT_ROOM_TYPES} />
      );

      const banner = screen.getByRole("alert");
      expect(banner).toBeInTheDocument();
      expect(banner.className).toContain("bg-amber-50");
      expect(banner.className).toContain("border-amber-200");

      expect(
        screen.getByText("Є причини, що блокують розміщення")
      ).toBeInTheDocument();

      // Concrete action items: Room 102 and 103 require confirmation, 103 requires type and height
      const description = screen.getByText(
        /Підтвердження контуру не заповнює дані/
      );
      expect(description).toHaveTextContent("Перевірте 102 і 103.");
      expect(description).toHaveTextContent(
        "Для 103 оберіть тип та вкажіть висоту."
      );
      expect(description).toHaveTextContent(
        "Підтвердження контуру не заповнює дані."
      );
    });

    it("does NOT render warning banner when all rooms are confirmed and complete", () => {
      const perfectRooms: Room[] = [
        {
          id: "p1",
          number: "101",
          name: "Офіс",
          roomType: "office",
          height: 3.0,
          area: 20.0,
          source: "auto",
          isConfirmed: true,
        },
      ];

      renderWithClient(
        <RoomsTable rooms={perfectRooms} roomTypes={DEFAULT_ROOM_TYPES} />
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Є причини, що блокують розміщення")
      ).not.toBeInTheDocument();
    });
  });
});

describe("DrawingDetail - 4 Top-level Tabs Integration", () => {
  const result = {
    ...DEMO_RESULT,
    sourceDownloadUrl: "https://storage.example/source",
    sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z",
    downloadUrl: "https://storage.example/file",
    downloadUrlExpiresAt: "2099-01-01T00:00:00Z",
  };

  const mockApi = {
    getDrawing: vi.fn().mockResolvedValue(result),
    processDrawing: vi.fn(),
  };

  it("renders all 4 tabs: План, Приміщення, Правила й норми, Звіт", async () => {
    renderWithClient(
      <DrawingDetail id="test-drawing" api={mockApi} initialTab="plan" />
    );

    expect(await screen.findByRole("tab", { name: /^План/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Приміщення/ })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Правила й норми" })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Звіт" })).toBeInTheDocument();
  });

  it("switches to 'Приміщення' tab when clicked and displays the RoomsTable view", async () => {
    renderWithClient(
      <DrawingDetail id="test-drawing" api={mockApi} initialTab="plan" />
    );

    const roomsTab = await screen.findByRole("tab", { name: /^Приміщення/ });
    fireEvent.click(roomsTab);

    // Rooms view should now be rendered
    expect(
      await screen.findByRole("heading", { level: 2, name: "Приміщення" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Клік по назві виділяє те саме приміщення на плані.")
    ).toBeInTheDocument();
  });

  it("renders an accessible edit trigger ('Редагувати') even when a room is complete and confirmed, and clicking it fires onEditRoom (Issue 3 Regression)", () => {
    const onEditRoom = vi.fn();
    const completeRoom: Room = {
      id: "r-complete",
      number: "101",
      name: "Кабінет директора",
      roomType: "office",
      height: 3.0,
      area: 24.5,
      source: "auto",
      isConfirmed: true,
    };

    renderWithClient(
      <RoomsTable
        rooms={[completeRoom]}
        roomTypes={DEFAULT_ROOM_TYPES}
        onEditRoom={onEditRoom}
      />
    );

    const editButton = screen.getByRole("button", { name: /Редагувати/i });
    expect(editButton).toBeInTheDocument();
    fireEvent.click(editButton);

    expect(onEditRoom).toHaveBeenCalledTimes(1);
    expect(onEditRoom).toHaveBeenCalledWith(completeRoom);
  });

  it("renders explicit 'Підтвердити' action for unconfirmed room and fires onConfirmRoom", () => {
    const onConfirmRoom = vi.fn();
    const unconfirmedRoom: Room = {
      id: "r-unconfirmed",
      number: "102",
      name: "Коридор",
      roomType: "corridor",
      height: 2.8,
      area: 18.0,
      source: "auto",
      isConfirmed: false,
    };

    renderWithClient(
      <RoomsTable
        rooms={[unconfirmedRoom]}
        roomTypes={DEFAULT_ROOM_TYPES}
        onConfirmRoom={onConfirmRoom}
      />
    );

    const confirmButton = screen.getByRole("button", { name: /Підтвердити$/i });
    expect(confirmButton).toBeInTheDocument();
    fireEvent.click(confirmButton);

    expect(onConfirmRoom).toHaveBeenCalledTimes(1);
    expect(onConfirmRoom).toHaveBeenCalledWith(unconfirmedRoom);
  });

  it("renders 'Підтвердити всі' button in header when there are unconfirmed rooms and fires onConfirmAllRooms", () => {
    const onConfirmAllRooms = vi.fn();
    const unconfirmedRooms: Room[] = [
      {
        id: "r1",
        number: "101",
        name: "Кімната 1",
        roomType: "office",
        height: 3.0,
        area: 20.0,
        source: "auto",
        isConfirmed: false,
      },
      {
        id: "r2",
        number: "102",
        name: "Кімната 2",
        roomType: "corridor",
        height: 2.8,
        area: 15.0,
        source: "manual",
        isConfirmed: false,
      },
    ];

    renderWithClient(
      <RoomsTable
        rooms={unconfirmedRooms}
        roomTypes={DEFAULT_ROOM_TYPES}
        onConfirmAllRooms={onConfirmAllRooms}
      />
    );

    const confirmAllButton = screen.getByRole("button", {
      name: /Підтвердити всі \(2\)/i,
    });
    expect(confirmAllButton).toBeInTheDocument();
    fireEvent.click(confirmAllButton);

    expect(onConfirmAllRooms).toHaveBeenCalledTimes(1);
  });
});
