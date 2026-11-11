// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RoomEditForm } from "@/components/rooms/room-edit-form";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import { parseHeightInput, HEIGHT_ERROR_MESSAGE } from "@/lib/rooms/validation";
import type { Room } from "@/types/rooms";
import { DEFAULT_ROOM_TYPES } from "@/lib/rooms/room-types-api";
import type { DrawingResult } from "@bim/contracts";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
  getSession.mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("parseHeightInput (Height Validation Helper)", () => {
  it("normalizes comma to dot and parses positive decimal values", () => {
    expect(parseHeightInput("3,0")).toEqual({ isValid: true, value: 3.0 });
    expect(parseHeightInput("3,5")).toEqual({ isValid: true, value: 3.5 });
    expect(parseHeightInput("0,75")).toEqual({ isValid: true, value: 0.75 });
    expect(parseHeightInput("12,4")).toEqual({ isValid: true, value: 12.4 });
  });

  it("parses dot decimal and integer values", () => {
    expect(parseHeightInput("3.0")).toEqual({ isValid: true, value: 3.0 });
    expect(parseHeightInput("2.8")).toEqual({ isValid: true, value: 2.8 });
    expect(parseHeightInput("4")).toEqual({ isValid: true, value: 4 });
  });

  it("handles surrounding whitespace cleanly", () => {
    expect(parseHeightInput("  3,2  ")).toEqual({ isValid: true, value: 3.2 });
    expect(parseHeightInput(" 5 ")).toEqual({ isValid: true, value: 5 });
  });

  it("rejects zero and returns the exact Ukrainian error message", () => {
    expect(parseHeightInput("0")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("0.0")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("0,00")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
  });

  it("rejects negative values with error message", () => {
    expect(parseHeightInput("-1")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("-3,5")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
  });

  it("rejects empty, null, or whitespace-only strings", () => {
    expect(parseHeightInput("")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("   ")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    // @ts-expect-error test runtime null handling
    expect(parseHeightInput(null)).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
  });

  it("rejects non-numeric strings and invalid formats", () => {
    expect(parseHeightInput("abc")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("3m")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("3,0,0")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("NaN")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
    expect(parseHeightInput("Infinity")).toEqual({
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    });
  });
});

describe("RoomEditForm (layout 03-data)", () => {
  const unconfirmedIncompleteRoom: Room = {
    id: "r-1",
    number: "103",
    name: "Серверна",
    roomType: null,
    height: null,
    area: 15.0,
    source: "manual",
    isConfirmed: false,
  };

  const confirmedIncompleteRoom: Room = {
    id: "r-2",
    number: "102",
    name: "Офіс менеджерів",
    roomType: null,
    height: null,
    area: 25.0,
    source: "auto",
    isConfirmed: true,
  };

  const confirmedCompleteRoom: Room = {
    id: "r-complete",
    number: "101",
    name: "Кабінет директора",
    roomType: "office",
    height: 3.0,
    area: 24.5,
    source: "auto",
    isConfirmed: true,
  };

  it("renders header title with room number and name", () => {
    renderWithClient(
      <RoomEditForm
        room={unconfirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    expect(
      screen.getByRole("heading", {
        name: "103 · Серверна — заповнення даних",
        level: 2,
      })
    ).toBeInTheDocument();
  });

  it("renders dynamic subtitle reflecting room confirmation and missing data state", () => {
    const { rerender } = renderWithClient(
      <RoomEditForm
        room={unconfirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    // Unconfirmed + both incomplete
    expect(
      screen.getByText(
        "Контур не підтверджено. Тип і висота залишаються незаповненими."
      )
    ).toBeInTheDocument();

    // Confirmed + both incomplete
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RoomEditForm
          room={confirmedIncompleteRoom}
          roomTypes={DEFAULT_ROOM_TYPES}
        />
      </QueryClientProvider>
    );
    expect(
      screen.getByText(
        "Контур підтверджено. Тип і висота залишаються незаповненими."
      )
    ).toBeInTheDocument();
  });

  it("renders the 2-column layout cards 'Дані приміщення' and 'Що потрібно виправити'", () => {
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Дані приміщення", level: 3 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Що потрібно виправити", level: 3 })
    ).toBeInTheDocument();

    // Guidelines text in right card
    expect(
      screen.getByText(/Виберіть тип зі списку системи/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Значення 3,0 та 3.0 приймаються як 3 м/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Помилку показуємо біля відповідного поля/)
    ).toBeInTheDocument();
  });

  it("populates the room type dropdown with catalog options and placeholder", () => {
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    const select = screen.getByLabelText("Тип приміщення");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("");

    // Check placeholder option
    expect(screen.getByRole("option", { name: "Тип не визначено" })).toBeInTheDocument();

    // Check catalog options from default room types
    expect(screen.getByRole("option", { name: /Офіс/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Коридор/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Кухня/ })).toBeInTheDocument();
  });

  it("populates initial height formatted with comma if present", () => {
    const roomWithHeight: Room = {
      ...confirmedIncompleteRoom,
      height: 3.2,
    };

    renderWithClient(
      <RoomEditForm
        room={roomWithHeight}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    const input = screen.getByLabelText("Висота, м");
    expect(input).toHaveValue("3,2");
  });

  it("validates height on submit: shows inline error, applies red border, retains user input, and focuses input", async () => {
    const onSave = vi.fn();
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
        onSave={onSave}
      />
    );

    const input = screen.getByLabelText("Висота, м") as HTMLInputElement;
    const submitBtn = screen.getByRole("button", { name: "Зберегти дані" });

    // Type invalid non-positive height
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(submitBtn);

    // Expect inline error message
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(HEIGHT_ERROR_MESSAGE);
    expect(input).toHaveClass("border-red-500");

    // STRICT REQUIREMENT: Input MUST NOT be cleared on error!
    expect(input.value).toBe("0");

    // Input should be focused
    expect(document.activeElement).toBe(input);
    expect(onSave).not.toHaveBeenCalled();

    // Type text string
    fireEvent.change(input, { target: { value: "абв" } });
    fireEvent.click(submitBtn);

    expect(screen.getByRole("alert")).toHaveTextContent(HEIGHT_ERROR_MESSAGE);
    expect(input.value).toBe("абв");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submits successfully with valid comma decimal and updates room data", async () => {
    const onSave = vi.fn();
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
        onSave={onSave}
      />
    );

    const select = screen.getByLabelText("Тип приміщення");
    const input = screen.getByLabelText("Висота, м");
    const submitBtn = screen.getByRole("button", { name: "Зберегти дані" });

    // Select type "office"
    fireEvent.change(select, { target: { value: "office" } });

    // Enter height with comma "3,0"
    fireEvent.change(input, { target: { value: "3,0" } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    expect(onSave).toHaveBeenCalledWith({
      ...confirmedIncompleteRoom,
      roomType: "office",
      type: "office",
      height: 3.0,
    });
  });

  it("dynamically updates the checklist in 'Що потрібно виправити'", () => {
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
      />
    );

    const checklistCard = screen
      .getByRole("heading", { name: "Що потрібно виправити" })
      .closest("div")!;

    // Initially both incomplete
    expect(within(checklistCard).getByText("Тип не визначено")).toBeInTheDocument();
    expect(within(checklistCard).getByText("Висоту не вказано")).toBeInTheDocument();

    const select = screen.getByLabelText("Тип приміщення");
    const input = screen.getByLabelText("Висота, м");

    // Select type
    fireEvent.change(select, { target: { value: "kitchen" } });
    expect(within(checklistCard).getByText("Тип вказано")).toBeInTheDocument();
    expect(within(checklistCard).getByText("Висоту не вказано")).toBeInTheDocument();

    // Enter valid height
    fireEvent.change(input, { target: { value: "3,6" } });
    expect(within(checklistCard).getByText("Тип вказано")).toBeInTheDocument();
    expect(within(checklistCard).getByText("Висоту вказано")).toBeInTheDocument();
  });

  it("handles cancel button click", () => {
    const onCancel = vi.fn();
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
        onCancel={onCancel}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: "Скасувати" });
    fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables buttons and shows pending state when isSaving is true", () => {
    renderWithClient(
      <RoomEditForm
        room={confirmedIncompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
        isSaving={true}
      />
    );

    const submitBtn = screen.getByRole("button", { name: "Збереження…" });
    const cancelBtn = screen.getByRole("button", { name: "Скасувати" });

    expect(submitBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
  });

  it("calls onDirtyChange(true) when user modifies height or type, and false when restored or cancelled (Issue 1 Regression)", () => {
    const onDirtyChange = vi.fn();
    const onCancel = vi.fn();
    renderWithClient(
      <RoomEditForm
        room={confirmedCompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
        onDirtyChange={onDirtyChange}
        onCancel={onCancel}
      />
    );

    const heightInput = screen.getByLabelText("Висота, м");
    fireEvent.change(heightInput, { target: { value: "3,8" } });
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    // Revert back to original height
    fireEvent.change(heightInput, { target: { value: "3,0" } });
    expect(onDirtyChange).toHaveBeenCalledWith(false);

    // Change type
    const typeSelect = screen.getByLabelText("Тип приміщення");
    fireEvent.change(typeSelect, { target: { value: "kitchen" } });
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    // Cancel resets dirty
    const cancelBtn = screen.getByRole("button", { name: "Скасувати" });
    fireEvent.click(cancelBtn);
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it("submits roomType as 'unknown' when 'Тип не визначено' is selected (Issue 2 Regression)", async () => {
    const onSave = vi.fn();
    renderWithClient(
      <RoomEditForm
        room={confirmedCompleteRoom}
        roomTypes={DEFAULT_ROOM_TYPES}
        onSave={onSave}
      />
    );

    const typeSelect = screen.getByLabelText("Тип приміщення");
    // Select "Тип не визначено" (value "")
    fireEvent.change(typeSelect, { target: { value: "" } });

    const submitBtn = screen.getByRole("button", { name: "Зберегти дані" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const savedRoom = onSave.mock.calls[0][0] as Room;
    expect(savedRoom.roomType).toBe("unknown");
  });
});

describe("Placement Gating & Edit Flow Integration (DrawingDetail)", () => {
  const drawingWithIncompleteRooms: DrawingResult = {
    drawing: {
      id: "dwg-1",
      ownerId: "user-1",
      originalFileName: "plan.dxf",
      storagePath: "drawings/plan.dxf",
      resolvedUnits: "m",
      status: "processed",
      errorMessage: null,
      createdAt: "2026-11-10T10:00:00Z",
    },
    rooms: [
      {
        id: "room-1",
        drawingId: "dwg-1",
        name: "Офіс 101",
        type: "office",
        height: 3.0,
        area: 20,
        polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 5 }, { x: 0, y: 5 }],
      },
      {
        id: "room-2",
        drawingId: "dwg-1",
        name: "Коридор 102",
        type: null, // missing type
        height: null, // missing height
        area: 12,
        polygon: [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 3 }, { x: 4, y: 3 }],
      },
    ],
    devices: [],
    sourceDownloadUrl: "https://example.com/source.dxf",
    sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z",
    downloadUrl: "https://example.com/result.dxf",
    downloadUrlExpiresAt: "2099-01-01T00:00:00Z",
  };

  it("blocks placement action when rooms have incomplete data or unconfirmed contours", async () => {
    const mockApi = {
      getDrawing: vi.fn().mockResolvedValue(drawingWithIncompleteRooms),
      processDrawing: vi.fn(),
      placeDrawing: vi.fn().mockResolvedValue({ drawing_id: "dwg-1", status: "processed", result_path: "p" }),
    };

    renderWithClient(<DrawingDetail id="dwg-1" api={mockApi} />);

    // Wait for the drawing to load
    const placeBtn = await screen.findByRole("button", { name: "Розмістити" });
    expect(placeBtn).toBeDisabled();
    expect(placeBtn).toHaveAttribute(
      "title",
      expect.stringContaining("Розміщення заблоковано")
    );

    // Plan tab shows placement blocked alert banner
    const blockedBanner = await screen.findByRole("alert");
    expect(blockedBanner).toHaveTextContent(/Розміщення приладів заблоковано/);
  });

  it("enables navigating from table 'Заповнити' button to RoomEditForm and back", async () => {
    const mockApi = {
      getDrawing: vi.fn().mockResolvedValue(drawingWithIncompleteRooms),
      processDrawing: vi.fn(),
      placeDrawing: vi.fn(),
    };

    renderWithClient(
      <DrawingDetail id="dwg-1" api={mockApi} initialTab="rooms" />
    );

    // Table view is displayed
    const fillButton = await screen.findByRole("button", { name: "Заповнити" });
    expect(fillButton).toBeInTheDocument();

    // Click "Заповнити" to edit room-2
    fireEvent.click(fillButton);

    // Now RoomEditForm should be displayed for room-2
    expect(
      await screen.findByRole("heading", {
        name: "Коридор 102 — заповнення даних",
        level: 2,
      })
    ).toBeInTheDocument();

    // Click "До таблиці приміщень" to return
    const backBtn = screen.getByRole("button", { name: /До таблиці приміщень/ });
    fireEvent.click(backBtn);

    // Table is shown again
    expect(
      await screen.findByRole("button", { name: "Заповнити" })
    ).toBeInTheDocument();
  });

  const drawingWithCompleteRooms: DrawingResult = {
    drawing: {
      id: "dwg-complete",
      ownerId: "user-1",
      originalFileName: "complete-plan.dxf",
      storagePath: "drawings/complete-plan.dxf",
      resolvedUnits: "m",
      status: "processed",
      errorMessage: null,
      createdAt: "2026-11-10T10:00:00Z",
    },
    rooms: [
      {
        id: "room-1",
        drawingId: "dwg-complete",
        name: "Офіс 101",
        type: "office",
        height: 3.0,
        area: 20,
        polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 5 }, { x: 0, y: 5 }],
        source: "auto",
        confirmed: true,
      },
    ],
    devices: [],
    sourceDownloadUrl: "https://example.com/source.dxf",
    sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z",
    downloadUrl: "https://example.com/result.dxf",
    downloadUrlExpiresAt: "2099-01-01T00:00:00Z",
  };

  it("blocks placement action when room edit form has unsaved dirty changes, and restores when cancelled (Issue 1 Regression)", async () => {
    const mockApi = {
      getDrawing: vi.fn().mockResolvedValue(drawingWithCompleteRooms),
      processDrawing: vi.fn(),
      placeDrawing: vi.fn().mockResolvedValue({ drawing_id: "dwg-complete", status: "processed", result_path: "p" }),
    };

    renderWithClient(
      <DrawingDetail id="dwg-complete" api={mockApi} initialTab="rooms" />
    );

    // Initial state: room is complete and confirmed
    const placeBtn = await screen.findByRole("button", { name: "Розмістити" });
    expect(placeBtn).not.toBeDisabled();

    // Open room edit form
    const editBtn = await screen.findByRole("button", { name: "Редагувати" });
    fireEvent.click(editBtn);

    // Modify height without saving -> form is dirty
    const heightInput = await screen.findByLabelText("Висота, м");
    fireEvent.change(heightInput, { target: { value: "4,0" } });

    // Placement button must now be blocked
    expect(placeBtn).toBeDisabled();
    expect(placeBtn).toHaveAttribute(
      "title",
      expect.stringContaining("Збережіть або скасуйте зміни приміщення")
    );

    // Click "Скасувати" in form -> dirty state reset, form closed
    const cancelBtn = screen.getByRole("button", { name: "Скасувати" });
    fireEvent.click(cancelBtn);

    // Placement button restored
    expect(placeBtn).not.toBeDisabled();
  });

  it("blocks placement action while room update mutation is in flight (Issue 1 Regression)", async () => {
    let resolvePatch: (val: unknown) => void = () => {};
    const patchPromise = new Promise<unknown>((resolve) => {
      resolvePatch = resolve;
    });

    // Mock global fetch for updateRoom PATCH call
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/rooms/")) {
        return patchPromise.then(
          () =>
            new Response(
              JSON.stringify({
                id: "room-1",
                drawingId: "dwg-complete",
                name: "Офіс 101",
                type: "office",
                height: 3.5,
                area: 20,
                polygon: [
                  { x: 0, y: 0 },
                  { x: 4, y: 0 },
                  { x: 4, y: 5 },
                  { x: 0, y: 5 },
                ],
                source: "auto",
                confirmed: true,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mockApi = {
      getDrawing: vi.fn().mockResolvedValue(drawingWithCompleteRooms),
      processDrawing: vi.fn(),
      placeDrawing: vi.fn().mockResolvedValue({ drawing_id: "dwg-complete", status: "processed", result_path: "p" }),
    };

    renderWithClient(
      <DrawingDetail id="dwg-complete" api={mockApi} initialTab="rooms" />
    );

    const placeBtn = await screen.findByRole("button", { name: "Розмістити" });
    expect(placeBtn).not.toBeDisabled();

    // Open edit form
    const editBtn = await screen.findByRole("button", { name: "Редагувати" });
    fireEvent.click(editBtn);

    // Change height
    const heightInput = await screen.findByLabelText("Висота, м");
    fireEvent.change(heightInput, { target: { value: "3,5" } });

    // Submit form -> mutation in flight
    const saveBtn = screen.getByRole("button", { name: "Зберегти дані" });
    fireEvent.click(saveBtn);

    // Placement button must be blocked while pending
    await waitFor(() => {
      expect(placeBtn).toBeDisabled();
      expect(placeBtn).toHaveAttribute(
        "title",
        expect.stringContaining("Триває збереження даних")
      );
    });

    // Resolve the mutation
    resolvePatch({});
    await waitFor(() => {
      expect(placeBtn).not.toBeDisabled();
    });

    vi.unstubAllGlobals();
  });

  it("preserves user input in form and keeps placement blocked when save fails with error (Issue 1 Regression)", async () => {
    // Mock fetch to reject with 500 error
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/rooms/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "Database error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mockApi = {
      getDrawing: vi.fn().mockResolvedValue(drawingWithCompleteRooms),
      processDrawing: vi.fn(),
      placeDrawing: vi.fn().mockResolvedValue({ drawing_id: "dwg-complete", status: "processed", result_path: "p" }),
    };

    renderWithClient(
      <DrawingDetail id="dwg-complete" api={mockApi} initialTab="rooms" />
    );

    const placeBtn = await screen.findByRole("button", { name: "Розмістити" });
    expect(placeBtn).not.toBeDisabled();

    // Open edit form
    const editBtn = await screen.findByRole("button", { name: "Редагувати" });
    fireEvent.click(editBtn);

    // Enter modified height
    const heightInput = await screen.findByLabelText("Висота, м");
    fireEvent.change(heightInput, { target: { value: "4,2" } });

    // Submit save which will fail
    const saveBtn = screen.getByRole("button", { name: "Зберегти дані" });
    fireEvent.click(saveBtn);

    // Wait for mutation failure
    await waitFor(() => {
      // User input must still be in the form (NOT wiped or reset)
      expect(heightInput).toHaveValue("4,2");
    });

    // Form must remain open
    expect(screen.getByRole("heading", { name: /Офіс 101 — заповнення даних/ })).toBeInTheDocument();

    // Placement must remain blocked with unsaved changes
    expect(placeBtn).toBeDisabled();
    expect(placeBtn).toHaveAttribute(
      "title",
      expect.stringContaining("Збережіть або скасуйте зміни приміщення")
    );

    vi.unstubAllGlobals();
  });

  it("executes full cycle: changing type from office to unknown sends 'unknown', refetches room with insufficient data, and blocks placement (Issue 2 Regression)", async () => {
    let currentRoomType: string | null = "office";
    const dynamicDrawing: DrawingResult = {
      ...drawingWithCompleteRooms,
      rooms: [
        {
          id: "room-1",
          drawingId: "dwg-complete",
          name: "Офіс 101",
          type: "office",
          height: 3.0,
          area: 20,
          polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 5 }, { x: 0, y: 5 }],
          source: "auto",
          confirmed: true,
        },
      ],
    };

    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/rooms/")) {
        currentRoomType = "unknown";
        dynamicDrawing.rooms[0].type = "unknown";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "room-1",
              drawingId: "dwg-complete",
              name: "Офіс 101",
              type: "unknown",
              height: 3.0,
              area: 20,
              polygon: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 5 },
                { x: 0, y: 5 },
              ],
              source: "auto",
              confirmed: true,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mockApi = {
      getDrawing: vi.fn().mockImplementation(() =>
        Promise.resolve({
          ...dynamicDrawing,
          rooms: [
            {
              ...dynamicDrawing.rooms[0],
              type: currentRoomType,
            },
          ],
        })
      ),
      processDrawing: vi.fn(),
      placeDrawing: vi.fn().mockResolvedValue({ drawing_id: "dwg-complete", status: "processed", result_path: "p" }),
    };

    renderWithClient(
      <DrawingDetail id="dwg-complete" api={mockApi} initialTab="rooms" />
    );

    const placeBtn = await screen.findByRole("button", { name: "Розмістити" });
    expect(placeBtn).not.toBeDisabled();

    // Click "Редагувати"
    const editBtn = await screen.findByRole("button", { name: "Редагувати" });
    fireEvent.click(editBtn);

    // Select "Тип не визначено"
    const typeSelect = await screen.findByLabelText("Тип приміщення");
    fireEvent.change(typeSelect, { target: { value: "" } });

    // Submit save
    const saveBtn = screen.getByRole("button", { name: "Зберегти дані" });
    fireEvent.click(saveBtn);

    // Form should save and return to table
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /заповнення даних/ })).not.toBeInTheDocument();
    });

    // Verify PATCH body sent 'unknown'
    const patchCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes("/api/v1/rooms/")
    );
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(patchCall![1].body);
    expect(patchBody).toHaveProperty("type", "unknown");

    // Completeness badge in table should now show "Недостатньо даних"
    expect(
      screen.getByText("Недостатньо даних")
    ).toBeInTheDocument();

    // Placement button should now be blocked
    expect(placeBtn).toBeDisabled();
    expect(placeBtn).toHaveAttribute(
      "title",
      expect.stringContaining("Розміщення заблоковано")
    );

    vi.unstubAllGlobals();
  });
});
