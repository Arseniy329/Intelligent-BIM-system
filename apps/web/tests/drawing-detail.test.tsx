import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { DrawingViewerProps } from "@/components/drawing/drawing-viewer";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import DrawingPage from "../app/(protected)/drawings/[id]/page";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import { ApiHttpError } from "@/lib/api";

const { state, viewer } = vi.hoisted(() => ({ state: { value: {} as Record<string, unknown> }, viewer: vi.fn() }));
vi.mock("@/lib/drawing/use-drawing-detail", () => ({ useDrawingDetail: () => state.value }));
vi.mock("@/components/drawing/drawing-viewer", () => ({ DrawingViewer: (props: DrawingViewerProps) => { viewer(props); return <div>DXF viewer</div>; } }));
const result = { ...DEMO_RESULT, sourceDownloadUrl: "https://storage.example/source", sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z", downloadUrl: "https://storage.example/file", downloadUrlExpiresAt: "2099-01-01T00:00:00Z" };
function render(children: ReactNode) {
  const client = new QueryClient();
  try { return renderToStaticMarkup(<QueryClientProvider client={client}>{children}</QueryClientProvider>); }
  finally { client.clear(); }
}
beforeEach(() => {
  viewer.mockClear();
  state.value = { detail: { data: result }, process: {}, place: {}, currentJob: null, busy: false };
});
it("resolves route params and keys the page by drawing ID", async () => {
  const element = await DrawingPage({ params: Promise.resolve({ id: "drawing-42" }) });
  expect(element.props.id).toBe("drawing-42");
  expect(element.key).toBe("drawing-42");
});
it("passes exact Room[]/Device[] to the existing viewer and shows counts and m²", () => {
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(viewer.mock.calls[0][0]).toMatchObject({ rooms: result.rooms, devices: result.devices, url: result.sourceDownloadUrl });
  expect(html).toContain("Приміщень: 3 · Сповіщувачів: 4");
  expect(html).toContain("20 м²");
  expect(html).toContain("Завантажити DXF результату");
});
it("renders empty results without confusing them with pending processing", () => {
  state.value.detail = { data: { ...result, rooms: [], devices: [] } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain("Приміщень: 0 · Сповіщувачів: 0");
  expect(html).toContain("Приміщень не знайдено");
  expect(html).toContain("Сповіщувачів не знайдено");
});
it("shows rooms without devices", () => {
  state.value.detail = { data: { ...result, devices: [] } };
  expect(render(<DrawingDetail id={result.drawing.id} />)).toContain("Приміщень: 3 · Сповіщувачів: 0");
});
it("shows the stored incomplete-placement report after a reload, not only right after POST /place", () => {
  // Nothing ran in this session (`place` is empty): the report comes with the GET result.
  state.value.detail = { data: { ...result, placementReport: {
    placementStatus: "partial", deviceCount: 4,
    placementIssues: [{ title: "Hall — Решта приміщення", reason: "Частину приміщення (≈40 м², 50 %) не віднесено до жодної зони" }],
  } } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain('data-slot="placement-incomplete-banner"');
  expect(html).toContain("Розміщення неповне");
  expect(html).toContain("Hall — Решта приміщення");
  expect(html).toContain("не віднесено до жодної зони");
  // The result itself is still shown next to the reasons.
  expect(html).toContain("Приміщень: 3 · Сповіщувачів: 4");
  expect(html).toContain("Завантажити DXF результату");
});
it("shows no incomplete banner for a complete stored report or a result without one", () => {
  state.value.detail = { data: { ...result, placementReport: { placementStatus: "complete", deviceCount: 4, placementIssues: [] } } };
  expect(render(<DrawingDetail id={result.drawing.id} />)).not.toContain("placement-incomplete-banner");
  state.value.detail = { data: result };
  expect(render(<DrawingDetail id={result.drawing.id} />)).not.toContain("placement-incomplete-banner");
});
it("prefers the report of the POST that just ran over the stored one", () => {
  state.value.detail = { data: { ...result, placementReport: { placementStatus: "partial", placementIssues: [{ title: "Old", reason: "stored reason" }] } } };
  state.value.place = { data: { drawingId: result.drawing.id, status: "processed", placementStatus: "insufficient_data", deviceCount: 0,
    placementIssues: [{ title: "Fresh", reason: "fresh reason" }] } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain("Прилади не розміщено: бракує даних.");
  expect(html).toContain("fresh reason");
  expect(html).not.toContain("stored reason");
});
it("keeps the step warnings visible after a reload: the stored report carries them", () => {
  // A reload has no POST state; the warnings come only from the stored report of GET.
  state.value.detail = { data: { ...result, placementReport: {
    placementStatus: "complete", deviceCount: 4, placementIssues: [],
    warnings: ["Ручні сповіщувачі: Шлях евакуації між виходами не підтверджено. Приміщення: East"],
  } } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain('data-slot="operation-warnings-banner"');
  expect(html).toContain("Шлях евакуації між виходами не підтверджено");
  expect(html).not.toContain("placement-incomplete-banner");
});
it("shows a failed exit step that was stored by /process, before any placement", () => {
  state.value.detail = { data: { ...result, placementReport: { warnings: ["Раніше збережені виходи й проходи лишено без змін"] } } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain('data-slot="operation-warnings-banner"');
  expect(html).toContain("Раніше збережені виходи й проходи лишено без змін");
  expect(html).not.toContain("placement-incomplete-banner");
});
it("shows a warning once when the POST response and the stored report carry the same one", () => {
  const warning = "Раніше збережені виходи й проходи лишено без змін";
  state.value.detail = { data: { ...result, placementReport: { warnings: [warning] } } };
  state.value.process = { data: { drawingId: result.drawing.id, status: "processing", warnings: [warning] } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html.split(warning)).toHaveLength(2);
});
it("does not mistake a processing job for a report", () => {
  state.value.process = { data: { id: "job-1", drawingId: result.drawing.id, status: "queued", errorMessage: null } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).not.toContain("operation-warnings-banner");
  expect(html).not.toContain("placement-incomplete-banner");
});
it("disables the process button while the operation is active", () => {
  state.value.busy = true;
  expect(render(<DrawingDetail id={result.drawing.id} />)).toMatch(/disabled="">Обробка…/);
});
it("shows loading and distinct access errors with retry", () => {
  state.value.detail = { isPending: true };
  expect(render(<DrawingDetail id="one" />)).toContain("Завантаження креслення…");
  for (const [status, message] of [[401, "Сеанс завершився"], [403, "немає доступу"], [404, "не знайдено"]] as const) {
    state.value.detail = { error: new ApiHttpError(status) };
    const html = render(<DrawingDetail id="one" />);
    expect(html).toContain(message);
    expect(html).toContain("Спробувати знову");
  }
});
it("shows a bounded polling timeout with a manual refresh", () => {
  state.value.timedOut = true;
  expect(render(<DrawingDetail id={result.drawing.id} />)).toContain("Автоматичне оновлення зупинено через 2 хвилини");
});

it("hides cached drawing data after access is revoked", () => {
  state.value.detail = { data: result, isError: true, error: new ApiHttpError(403) };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain("немає доступу");
  expect(html).not.toContain(result.drawing.originalFileName);
  expect(viewer).not.toHaveBeenCalled();
});

it("shows the real source, failed status, unresolved units and disabled result download", () => {
  state.value.detail = { data: { id: "one", originalFileName: "one.dxf", units: "from_file", status: "failed", sourceDownloadUrl: result.downloadUrl, sourceDownloadUrlExpiresAt: result.downloadUrlExpiresAt } };
  const html = render(<DrawingDetail id="one" />);
  expect(html).toContain("Статус: Помилка обробки");
  expect(html).toContain("очікується визначення з файла");
  expect(html).toContain("Завантажити оригінальний DXF");
  expect(html).toMatch(/disabled="" aria-describedby="result-download-help">Завантажити DXF результату/);
  expect(html).toContain('href="/upload"');
  expect(viewer.mock.calls[0][0].rooms).toBeUndefined();
});

it("shows rooms immediately after synchronous processing", () => {
  state.value.detail = { data: { ...result, drawing: { ...result.drawing, status: "processing" }, devices: [], downloadUrl: null } };
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(html).toContain("Обробку приміщень завершено");
  expect(html).toContain("Приміщень: 3 · Сповіщувачів: 0");
  expect(html).toContain("Розмістити");
  expect(viewer.mock.calls[0][0].rooms).toEqual(result.rooms);
});
it("does not use a generated DXF as the overlay background", () => {
  state.value.detail = { data: { ...result, sourceDownloadUrl: null } };
  expect(render(<DrawingDetail id={result.drawing.id} />)).toContain("Файл для перегляду недоступний");
  expect(viewer).not.toHaveBeenCalled();
});

it("propagates selectedRoomId to the DrawingViewer props (Issue 2 Regression)", () => {
  render(<DrawingDetail id={result.drawing.id} />);
  expect(viewer.mock.calls[0][0]).toHaveProperty("selectedRoomId");
});
