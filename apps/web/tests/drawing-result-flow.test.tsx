// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingResult } from "@bim/contracts";
import example from "../../../packages/contracts/examples/drawing-result.json";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import type { DrawingViewerProps } from "@/components/drawing/drawing-viewer";

const { viewer } = vi.hoisted(() => ({ viewer: vi.fn() }));
vi.mock("@/components/drawing/drawing-viewer", () => ({
  DrawingViewer: (props: DrawingViewerProps) => {
    viewer(props);
    return <div data-testid="viewer" data-source={props.url} />;
  },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { access_token: "fixture-session" } } }),
} }) }));

const id = example.drawing.id;
const source = "https://storage.example/source.dxf";
const generated = "https://storage.example/result.dxf";
const expires = "2099-01-01T00:00:00Z";
const result: DrawingResult = {
  ...example as DrawingResult, sourceDownloadUrl: source, sourceDownloadUrlExpiresAt: expires,
  downloadUrl: generated, downloadUrlExpiresAt: expires,
};
const rooms: DrawingResult = { ...result, drawing: { ...result.drawing, status: "processing" }, devices: [], downloadUrl: null, downloadUrlExpiresAt: null };
const uploaded = {
  id, owner_id: result.drawing.ownerId, original_file_name: result.drawing.originalFileName,
  storage_path: result.drawing.storagePath, created_at: result.drawing.createdAt, units: "mm", status: "uploaded",
  source_download_url: source, source_download_url_expires_at: expires,
};
let current: unknown;
let calls: string[];
let client: QueryClient;
let placeFailure: number | null;
const fetchMock = vi.fn();
beforeEach(() => {
  current = uploaded;
  calls = [];
  placeFailure = null;
  viewer.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example");
  fetchMock.mockReset().mockImplementation(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/process")) { current = rooms; return Response.json({ drawing_id: id, status: "processing" }); }
    if (url.pathname.endsWith("/place")) {
      if (placeFailure) return Response.json({ detail: "private SQL diagnostic token=secret" }, { status: placeFailure });
      current = result;
      return Response.json({ drawing_id: id, status: "processed", result_path: "private/result.dxf" });
    }
    return Response.json(current);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount() {
  return render(<QueryClientProvider client={client}><DrawingDetail id={id} /></QueryClientProvider>);
}

it("runs GET → process → GET rooms → place → GET devices without reloading the source", async () => {
  mount();
  await screen.findByRole("button", { name: "Обробити" });
  expect(calls).toEqual([`GET /api/v1/drawings/${id}`]);
  const canvas = screen.getByTestId("viewer");
  fireEvent.click(screen.getByRole("button", { name: "Обробити" }));
  await screen.findByText("Приміщень: 1 · Сповіщувачів: 0");
  expect(viewer.mock.lastCall?.[0]).toMatchObject({ rooms: rooms.rooms, devices: [], url: source });
  await waitFor(() => expect(screen.getByRole("button", { name: "Розмістити" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Розмістити" }));
  await screen.findByText("Приміщень: 1 · Сповіщувачів: 2");
  expect(viewer.mock.lastCall?.[0]).toMatchObject({ rooms: result.rooms, devices: result.devices, url: source });
  expect(screen.getByTestId("viewer")).toBe(canvas);
  expect(calls).toEqual([
    `GET /api/v1/drawings/${id}`, `POST /api/v1/drawings/${id}/process`, `GET /api/v1/drawings/${id}`,
    `POST /api/v1/drawings/${id}/place`, `GET /api/v1/drawings/${id}`,
  ]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Оновити стан" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Оновити стан" }));
  await waitFor(() => expect(calls).toHaveLength(6));
  expect(viewer.mock.lastCall?.[0].rooms).toHaveLength(1);
  expect(viewer.mock.lastCall?.[0].devices).toHaveLength(2);
});

it("reopens results without POST and requires confirmation before replacing rooms", async () => {
  current = result;
  mount();
  await screen.findByText("Приміщень: 1 · Сповіщувачів: 2");
  expect(calls.every(call => call.startsWith("GET"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Обробити повторно" }));
  expect(screen.getByText(/перезапише приміщення/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Обробити повторно" }));
  fireEvent.click(screen.getByRole("button", { name: "Підтвердити повторну обробку" }));
  await screen.findByText("Приміщень: 1 · Сповіщувачів: 0");
  expect(screen.getByRole("button", { name: "Завантажити DXF результату" })).toBeDisabled();
});

it.each([400, 422, 500])("handles placement HTTP %s without leaking details or faking devices", async status => {
  current = rooms;
  placeFailure = status;
  mount();
  await screen.findByText("Приміщень: 1 · Сповіщувачів: 0");
  fireEvent.click(screen.getByRole("button", { name: "Розмістити" }));
  await screen.findByRole("alert");
  expect(document.body.textContent).not.toMatch(/SQL|secret|private/);
  expect(screen.getByText("Приміщень: 1 · Сповіщувачів: 0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Завантажити DXF результату" })).toBeDisabled();
  expect(calls.filter(call => call.startsWith("POST"))).toHaveLength(1);
});

it("blocks duplicate process clicks and simultaneous placement", async () => {
  let finish!: (value: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  fetchMock.mockImplementationOnce(async () => Response.json(uploaded)).mockImplementationOnce(() => response);
  mount();
  const button = await screen.findByRole("button", { name: "Обробити" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Розмістити" })).toBeDisabled();
  current = rooms;
  await act(async () => { finish(Response.json({ drawing_id: id, status: "processing" })); });
  await screen.findByText("Приміщень: 1 · Сповіщувачів: 0");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("refreshes an expired download link through GET before fetching only the result", async () => {
  current = { ...result, downloadUrl: "https://storage.example/expired", downloadUrlExpiresAt: "2000-01-01T00:00:00Z" };
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const create = vi.fn(() => "blob:fixture-download");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  mount();
  const button = await screen.findByRole("button", { name: "Завантажити DXF результату" });
  current = result;
  fetchMock.mockImplementationOnce(async () => { calls.push("refresh download"); return Response.json(result); })
    .mockImplementationOnce(async (url, init) => {
      expect(url).toBe(generated);
      expect(init.headers).toBeUndefined();
      expect(init.credentials).toBe("omit");
      return new Response("generated fixture DXF");
    });
  fireEvent.click(button);
  await screen.findByText("DXF передано браузеру для збереження.");
  expect(calls).toContain("refresh download");
  expect(create).toHaveBeenCalledOnce();
});

it("does not place or report success for an empty room result", async () => {
  current = { ...rooms, rooms: [] };
  mount();
  await screen.findByText("Приміщень не знайдено.");
  expect(screen.getByRole("button", { name: "Розмістити" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Завантажити DXF результату" })).toBeDisabled();
});
