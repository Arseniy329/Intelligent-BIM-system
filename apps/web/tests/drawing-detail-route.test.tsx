// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingResult } from "@bim/contracts";
import example from "../../../packages/contracts/examples/drawing-result.json";
import { DrawingDetailRoute } from "@/app/(protected)/drawings/[id]/drawing-detail-route";
import type { DrawingViewerProps } from "@/components/drawing/drawing-viewer";

const { viewer, replace } = vi.hoisted(() => ({
  viewer: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/components/drawing/drawing-viewer", () => ({
  DrawingViewer: (props: DrawingViewerProps) => {
    viewer(props);
    return <div data-testid="viewer" data-source={props.url} />;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "fixture-session" } },
      }),
    },
  }),
}));

const id = example.drawing.id;
const source = "https://storage.example/source.dxf";
const generated = "https://storage.example/result.dxf";
const expires = "2099-01-01T00:00:00Z";
const result: DrawingResult = {
  ...(example as DrawingResult),
  sourceDownloadUrl: source,
  sourceDownloadUrlExpiresAt: expires,
  downloadUrl: generated,
  downloadUrlExpiresAt: expires,
};
const rooms: DrawingResult = {
  ...result,
  drawing: { ...result.drawing, status: "processing" },
  devices: [],
  downloadUrl: null,
  downloadUrlExpiresAt: null,
};
const uploaded = {
  id,
  filename: result.drawing.originalFileName,
  uploaded_at: result.drawing.createdAt,
  status: "uploaded",
  error_message: null,
  has_result: false,
  owner_id: result.drawing.ownerId,
  original_file_name: result.drawing.originalFileName,
  storage_path: result.drawing.storagePath,
  created_at: result.drawing.createdAt,
  units: "mm",
  source_download_url: source,
  source_download_url_expires_at: expires,
};

let stage: "uploaded" | "rooms" | "processed";
let calls: string[];
let client: QueryClient;
const fetchMock = vi.fn();

beforeEach(() => {
  stage = "uploaded";
  calls = [];
  viewer.mockClear();
  replace.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example");
  fetchMock.mockReset().mockImplementation(async (input: URL | string, init?: RequestInit) => {
    const raw = String(input);
    if (raw.startsWith("https://storage.example/")) {
      return new Response("fixture dxf");
    }
    const url = new URL(raw);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (method === "POST" && url.pathname.endsWith("/process")) {
      stage = "rooms";
      return Response.json({ drawing_id: id, status: "processing" });
    }
    if (method === "POST" && url.pathname.endsWith("/place")) {
      stage = "processed";
      return Response.json({ drawing_id: id, status: "processed" });
    }
    if (stage === "rooms") return Response.json(rooms);
    if (stage === "processed") return Response.json(result);
    return Response.json(uploaded);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <DrawingDetailRoute id={id} />
    </QueryClientProvider>,
  );
}

it("keeps process, place, saved result and export available from the drawing route", async () => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createObjectURL = vi.fn(() => "blob:fixture-download");
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
  );

  mount();

  const processButton = await screen.findByRole("button", { name: "Обробити" });
  expect(screen.getByText("Статус: Готове до обробки")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Розмістити" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Завантажити DXF результату" })).toBeDisabled();

  fireEvent.click(processButton);

  await screen.findByText("Приміщень: 1 · Сповіщувачів: 0");
  expect(viewer.mock.lastCall?.[0]).toMatchObject({
    rooms: rooms.rooms,
    devices: [],
    url: source,
  });

  const placeButton = screen.getByRole("button", { name: "Розмістити" });
  await waitFor(() => expect(placeButton).toBeEnabled());
  fireEvent.click(placeButton);

  await screen.findByText("Приміщень: 1 · Сповіщувачів: 2");
  expect(viewer.mock.lastCall?.[0]).toMatchObject({
    rooms: result.rooms,
    devices: result.devices,
    url: source,
  });

  const exportButton = screen.getByRole("button", {
    name: "Завантажити DXF результату",
  });
  expect(exportButton).toBeEnabled();
  fireEvent.click(exportButton);

  await screen.findByText("DXF передано браузеру для збереження.");
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(calls).toContain(`POST /api/v1/drawings/${id}/process`);
  expect(calls).toContain(`POST /api/v1/drawings/${id}/place`);
  expect(calls).toContain(`GET /api/v1/drawings/${id}`);
});

it("displays clear completeness message ('Не введено висоту') in summary and table when height is null, not 'Причина не вказана' and not verified", async () => {
  const drawingWithMissingHeight: DrawingResult = {
    ...rooms,
    rooms: [
      {
        id: "room-missing-h",
        drawingId: id,
        name: "Кабінет 101",
        type: "office",
        height: null,
        area: 48,
        source: "auto",
        confirmed: true,
        polygon: [
          { x: 0, y: 0 },
          { x: 8000, y: 0 },
          { x: 8000, y: 6000 },
          { x: 0, y: 6000 },
        ],
      },
    ],
  };

  fetchMock.mockImplementation(async (input: URL | string) => {
    const raw = String(input);
    if (raw.startsWith("https://storage.example/")) {
      return new Response("fixture dxf");
    }
    const url = new URL(raw);
    if (url.pathname.endsWith(`/api/v1/drawings/${id}`)) {
      return Response.json(drawingWithMissingHeight);
    }
    if (url.pathname.endsWith("/room-types")) {
      return Response.json([]);
    }
    return Response.json(drawingWithMissingHeight);
  });

  mount();

  // 1. Summary banner:
  const summaryBanner = await screen.findByRole("region", {
    name: "Приміщення без достатніх даних",
  });
  expect(summaryBanner).toBeInTheDocument();
  expect(
    within(summaryBanner).getByText("1 приміщення без достатніх даних")
  ).toBeInTheDocument();
  expect(
    within(summaryBanner).getByText("Не введено висоту")
  ).toBeInTheDocument();
  expect(
    within(summaryBanner).queryByText("Причина не вказана")
  ).not.toBeInTheDocument();
  expect(
    within(summaryBanner).queryByText("Перевірено")
  ).not.toBeInTheDocument();

  // 2. Navigate to "Приміщення" tab and check table:
  const roomsTab = screen.getByRole("tab", { name: /Приміщення/ });
  fireEvent.click(roomsTab);

  const tableRow = await screen.findByRole("row", {
    name: /Кабінет 101/,
  });
  expect(tableRow).toHaveAttribute("data-rule-status", "insufficient_data");
  expect(within(tableRow).getByText("Не введено висоту")).toBeInTheDocument();
  expect(
    within(tableRow).queryByText("Причина не вказана")
  ).not.toBeInTheDocument();
  expect(within(tableRow).queryByText("Перевірено")).not.toBeInTheDocument();
});

it("displays skipped/needs-review reason ('Немає правила для висоти 3.5 м') when type and height are present but no rule matches, not verified", async () => {
  const drawingWithUnmatchedRule: DrawingResult = {
    ...rooms,
    rooms: [
      {
        id: "room-unmatched",
        drawingId: id,
        name: "Кабінет 102",
        type: "office",
        height: 3.5,
        area: 50,
        source: "auto",
        confirmed: true,
        rule_status: "insufficient_data",
        rule_reason: "Немає правила для висоти 3.5 м",
        polygon: [
          { x: 0, y: 0 },
          { x: 8000, y: 0 },
          { x: 8000, y: 6000 },
          { x: 0, y: 6000 },
        ],
      },
    ],
  };

  fetchMock.mockImplementation(async (input: URL | string) => {
    const raw = String(input);
    if (raw.startsWith("https://storage.example/")) {
      return new Response("fixture dxf");
    }
    const url = new URL(raw);
    if (url.pathname.endsWith(`/api/v1/drawings/${id}`)) {
      return Response.json(drawingWithUnmatchedRule);
    }
    if (url.pathname.endsWith("/room-types")) {
      return Response.json([]);
    }
    return Response.json(drawingWithUnmatchedRule);
  });

  mount();

  // 1. Summary banner:
  const summaryBanner = await screen.findByRole("region", {
    name: "Приміщення без достатніх даних",
  });
  expect(summaryBanner).toBeInTheDocument();
  expect(
    within(summaryBanner).getByText("Немає правила для висоти 3.5 м")
  ).toBeInTheDocument();
  expect(
    within(summaryBanner).queryByText("Перевірено")
  ).not.toBeInTheDocument();

  // 2. Table:
  const roomsTab = screen.getByRole("tab", { name: /Приміщення/ });
  fireEvent.click(roomsTab);

  const tableRow = await screen.findByRole("row", {
    name: /Кабінет 102/,
  });
  expect(tableRow).toHaveAttribute("data-rule-status", "insufficient_data");
  expect(
    within(tableRow).getByText("Немає правила для висоти 3.5 м")
  ).toBeInTheDocument();
  expect(within(tableRow).queryByText("Перевірено")).not.toBeInTheDocument();
});

it("updates both Summary banner and Rooms Table simultaneously without page reload upon inline height update", async () => {
  let currentRoom = {
    id: "room-dynamic",
    drawingId: id,
    name: "Кабінет 103",
    type: "office",
    height: null as number | null,
    area: 36,
    source: "auto" as const,
    confirmed: true,
    rule_status: null as string | null,
    rule_reason: null as string | null,
    polygon: [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 6000 },
      { x: 0, y: 6000 },
    ],
  };

  fetchMock.mockImplementation(async (input: URL | string, init?: RequestInit) => {
    const raw = String(input);
    if (raw.startsWith("https://storage.example/")) {
      return new Response("fixture dxf");
    }
    const url = new URL(raw);
    const method = init?.method ?? "GET";

    if (method === "PATCH" && url.pathname.includes("/api/v1/rooms/")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      currentRoom = {
        ...currentRoom,
        height: body.height ?? currentRoom.height,
        rule_status: "needs_review",
        rule_reason: null,
      };
      return Response.json(currentRoom);
    }

    if (url.pathname.endsWith(`/api/v1/drawings/${id}`)) {
      return Response.json({
        ...rooms,
        rooms: [currentRoom],
      });
    }
    if (url.pathname.endsWith("/room-types")) {
      return Response.json([]);
    }
    return Response.json({
      ...rooms,
      rooms: [currentRoom],
    });
  });

  mount();

  // Initially height is null -> Summary banner is visible
  expect(
    await screen.findByRole("region", { name: "Приміщення без достатніх даних" })
  ).toBeInTheDocument();
  expect(screen.getByText("Не введено висоту")).toBeInTheDocument();

  // Navigate to Rooms tab
  const roomsTab = screen.getByRole("tab", { name: /Приміщення/ });
  fireEvent.click(roomsTab);

  // Click "Заповнити" to edit room
  const fillBtn = await screen.findByRole("button", { name: "Заповнити" });
  fireEvent.click(fillBtn);

  // Enter height in form
  const heightInput = await screen.findByLabelText("Висота, м");
  fireEvent.change(heightInput, { target: { value: "3,0" } });

  // Save data
  const saveBtn = screen.getByRole("button", { name: "Зберегти дані" });
  fireEvent.click(saveBtn);

  // After save without page reload:
  // 1. Summary banner should disappear (count 0)
  await waitFor(() => {
    expect(
      screen.queryByRole("region", { name: "Приміщення без достатніх даних" })
    ).not.toBeInTheDocument();
  });

  // 2. Rooms Table should simultaneously show "3,0 м" and updated completeness
  expect(screen.getByText("3,0 м")).toBeInTheDocument();
  expect(screen.queryByText("Не введено висоту")).not.toBeInTheDocument();
});
