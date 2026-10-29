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
const result = { ...DEMO_RESULT, downloadUrl: "https://storage.example/file", downloadUrlExpiresAt: "2099-01-01T00:00:00Z" };
function render(children: ReactNode) {
  const client = new QueryClient();
  try { return renderToStaticMarkup(<QueryClientProvider client={client}>{children}</QueryClientProvider>); }
  finally { client.clear(); }
}
beforeEach(() => {
  viewer.mockClear();
  state.value = { detail: { data: result }, process: {}, currentJob: null, busy: false };
});
it("resolves route params and keys the page by drawing ID", async () => {
  const element = await DrawingPage({ params: Promise.resolve({ id: "drawing-42" }) });
  expect(element.props.id).toBe("drawing-42");
  expect(element.key).toBe("drawing-42");
});
it("passes exact Room[]/Device[] to the existing viewer and shows counts and m²", () => {
  const html = render(<DrawingDetail id={result.drawing.id} />);
  expect(viewer.mock.calls[0][0]).toMatchObject({ rooms: result.rooms, devices: result.devices, url: result.downloadUrl });
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

it("explains accepted without presenting a processing result", () => {
  state.value.detail = { data: { id: "one", originalFileName: "one.dxf", units: "mm", status: "uploaded" } };
  state.value.accepted = true;
  const html = render(<DrawingDetail id="one" />);
  expect(html).toContain("Обробку не запущено, результат не створено");
  expect(html).toContain("Статус: Готове до обробки");
  expect(html).not.toContain("Приміщень: 3");
});
