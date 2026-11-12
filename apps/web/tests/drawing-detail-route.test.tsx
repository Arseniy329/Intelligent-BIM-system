// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
