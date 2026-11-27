// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Finding } from "@bim/contracts";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import { useFindings } from "@/lib/drawing/use-findings";
import { fetchFindings } from "@/lib/drawing/findings";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import type { DrawingViewerProps } from "@/components/drawing/drawing-viewer";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";
import { editApi } from "@/lib/drawing/edit-api";
import { planFeaturesApi } from "@/lib/drawing/plan-features-api";

vi.mock("@/lib/drawing/findings", async original => ({ ...await original<typeof import("@/lib/drawing/findings")>(), fetchFindings: vi.fn() }));
vi.mock("@/lib/api/rules", () => ({ fetchRules: async () => [] }));
vi.mock("@/lib/drawing/plan-features-api", () => ({ planFeaturesApi: { zones: vi.fn(async () => []), exits: vi.fn(async () => []), createZone: vi.fn(), updateZone: vi.fn(), deleteZone: vi.fn(), createExit: vi.fn(), deleteExit: vi.fn() } }));
vi.mock("@/lib/drawing/edit-api", () => ({ editApi: { updateDevice: vi.fn(), createDevice: vi.fn(), deleteDevice: vi.fn(), updateRoom: vi.fn(), createRoom: vi.fn(), deleteRoom: vi.fn(), confirmRooms: vi.fn(), regenerateDevices: vi.fn() } }));
const bridge = vi.hoisted(() => ({ props: null as DrawingViewerProps | null, mounted: vi.fn(), focusPoint: vi.fn(), deferReady: false }));
vi.mock("@/components/drawing/drawing-viewer", () => ({ DrawingViewer: function MockViewer(props: DrawingViewerProps) {
  bridge.props = props;
  const { onReady } = props;
  useEffect(() => { bridge.mounted(); if (!bridge.deferReady) onReady?.({ focusPoint: bridge.focusPoint } as unknown as DrawingViewportController); }, [onReady]);
  return <div data-testid="canvas">{props.findings?.map(f => <button key={f.id} onClick={() => props.onSelectFinding?.(f)}>Маркер {f.id}</button>)}</div>;
} }));
const finding: Finding = { id: "finding", drawingId: DEMO_RESULT.drawing.id, roomId: DEMO_RESULT.rooms[0].id, deviceId: null, ruleId: null, severity: "warning", message: "Перевірте приміщення", document: null, clause: null, ruleStatus: null };
const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return function Wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.clearAllMocks(); bridge.deferReady = false; });

it("reveals and scrolls the same critical marker after an intentional warning filter", async () => {
  const critical = { ...finding, id: "A", severity: "critical" as const, message: "Критичне A" };
  const warning = { ...finding, id: "B", message: "Попередження B" };
  vi.mocked(fetchFindings).mockResolvedValue([critical, warning]);
  const scroll = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  try {
    const result = { ...DEMO_RESULT, drawing: { ...DEMO_RESULT.drawing, status: "processed" as const }, sourceDownloadUrl: "https://example.test/source.dxf", sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z" };
    render(<DrawingDetail id={finding.drawingId} api={{ getDrawing: async () => result, processDrawing: async () => result }} initialTab="findings" />, { wrapper: wrapper() });
    await screen.findByText(critical.message);
    fireEvent.click(screen.getByRole("button", { name: "Маркер A" }));
    expect(screen.getByText(critical.message)).toBeVisible();
    expect(screen.getByText(critical.message).closest("li")).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Попередження · 1" }));
    expect(screen.queryByText(critical.message)).not.toBeInTheDocument();
    expect(screen.getByText(warning.message)).toBeVisible();
    scroll.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Маркер A" }));
    expect(screen.getByText(critical.message)).toBeVisible();
    const card = screen.getByText(critical.message).closest("li");
    expect(card).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("button", { name: "Усі результати" })).toHaveAttribute("aria-pressed", "true");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts).toContain(card);

    // A repeated activation while visible must still scroll.
    scroll.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Маркер A" }));
    expect(scroll.mock.contexts).toContain(card);
    const canvas = screen.getByTestId("canvas");
    const focusCalls = bridge.focusPoint.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Попередження · 1" }));
    expect(screen.queryByText(critical.message)).not.toBeInTheDocument();
    expect(bridge.focusPoint).toHaveBeenCalledTimes(focusCalls);

    // B shares A's room, but its compatible filter must survive activation.
    fireEvent.click(screen.getByRole("button", { name: "Маркер B" }));
    expect(screen.getByRole("button", { name: "Попередження · 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(warning.message).closest("li")).toHaveAttribute("data-selected", "true");
    expect(screen.queryByText(critical.message)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(warning.message) }));
    expect(bridge.props?.selectedFindingId).toBe("B");
    expect(bridge.focusPoint).toHaveBeenCalledTimes(focusCalls + 2);
    expect(screen.getByRole("button", { name: "Попередження · 1" })).toHaveAttribute("aria-pressed", "true");

    // A different, hidden marker must also reset the incompatible filter.
    fireEvent.click(screen.getByRole("button", { name: "Маркер A" }));
    expect(screen.getByText(critical.message)).toBeVisible();
    expect(screen.getByText(critical.message).closest("li")).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("button", { name: "Усі результати" })).toHaveAttribute("aria-pressed", "true");
    const beforeTabs = bridge.focusPoint.mock.calls.length;
    fireEvent.click(screen.getByRole("tab", { name: "План" }));
    fireEvent.click(screen.getByRole("tab", { name: "Порушення" }));
    expect(screen.getByTestId("canvas")).toBe(canvas);
    expect(bridge.mounted).toHaveBeenCalledOnce();
    expect(bridge.focusPoint).toHaveBeenCalledTimes(beforeTabs);
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", previous);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("honors a list selection made before the DXF is ready", async () => {
  bridge.deferReady = true;
  vi.mocked(fetchFindings).mockResolvedValue([finding]);
  const result = { ...DEMO_RESULT, drawing: { ...DEMO_RESULT.drawing, status: "processed" as const }, sourceDownloadUrl: "https://example.test/source.dxf", sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z" };
  render(<DrawingDetail id={finding.drawingId} api={{ getDrawing: async () => result, processDrawing: async () => result }} initialTab="findings" />, { wrapper: wrapper() });
  await screen.findByText(finding.message);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(finding.message) }));
  expect(bridge.focusPoint).not.toHaveBeenCalled();
  act(() => bridge.props?.onReady?.({ focusPoint: bridge.focusPoint } as unknown as DrawingViewportController));
  expect(bridge.focusPoint).toHaveBeenCalledOnce();
});

it("isolates drawing/revision requests, aborts outdated work and ignores late responses", async () => {
  const requests: { id: string; signal?: AbortSignal; resolve: (data: Finding[]) => void }[] = [];
  vi.mocked(fetchFindings).mockImplementation((id, signal) => new Promise(resolve => requests.push({ id, signal, resolve })));
  const hook = renderHook(({ id, revision }) => useFindings(id, revision, true), { wrapper: wrapper(), initialProps: { id: "a", revision: 1 } });
  await waitFor(() => expect(requests).toHaveLength(1));
  hook.rerender({ id: "a", revision: 2 });
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0].signal?.aborted).toBe(true);
  await act(async () => requests[1].resolve([{ ...finding, id: "new" }]));
  await waitFor(() => expect(hook.result.current.data?.[0].id).toBe("new"));
  await act(async () => requests[0].resolve([{ ...finding, id: "old" }]));
  expect(hook.result.current.data?.[0].id).toBe("new");
  hook.rerender({ id: "b", revision: 2 });
  expect(hook.result.current.data).toBeUndefined();
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2].id).toBe("b");
});

it("synchronizes list and plan, refreshes after edits, clears removed selections and retains the viewer", async () => {
  vi.mocked(fetchFindings).mockResolvedValue([finding]);
  const result = { ...DEMO_RESULT, drawing: { ...DEMO_RESULT.drawing, status: "processed" as const }, sourceDownloadUrl: "https://example.test/source.dxf", sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z" };
  const api = { getDrawing: vi.fn(async () => result), processDrawing: vi.fn(async () => result) };
  render(<DrawingDetail id={finding.drawingId} api={api} initialTab="findings" />, { wrapper: wrapper() });
  await screen.findByText(finding.message);
  const canvas = screen.getByTestId("canvas");
  expect(bridge.props?.workPanel).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(finding.message) }));
  expect(bridge.focusPoint).toHaveBeenCalledOnce();
  expect(bridge.props?.selectedFindingId).toBe(finding.id);
  fireEvent.click(screen.getByRole("tab", { name: "План" }));
  expect(bridge.props?.workPanel).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Маркер finding" }));
  expect(screen.getByRole("tab", { name: "Порушення" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: new RegExp(finding.message) })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("canvas")).toBe(canvas);
  expect(bridge.mounted).toHaveBeenCalledOnce();
  const focusCalls = bridge.focusPoint.mock.calls.length;
  // All editor mutations share its committed refresh path.
  vi.mocked(fetchFindings).mockResolvedValue([]);
  act(() => bridge.props?.editor?.confirm(DEMO_RESULT.rooms[0].id));
  await screen.findByText("Порушень не знайдено");
  expect(editApi.updateRoom).toHaveBeenCalled();
  expect(fetchFindings).toHaveBeenCalledTimes(2);
  expect(bridge.props?.selectedFindingId).toBeNull();
  expect(bridge.focusPoint).toHaveBeenCalledTimes(focusCalls);
  expect(screen.getByTestId("canvas")).toBe(canvas);
  expect(bridge.mounted).toHaveBeenCalledOnce();
  expect(planFeaturesApi.zones).toHaveBeenCalledTimes(2);
});

it.each(["device", "room", "zone", "exit"] as const)("refreshes findings after a %s deletion", async kind => {
  vi.mocked(fetchFindings).mockResolvedValue([finding]);
  const result = { ...DEMO_RESULT, drawing: { ...DEMO_RESULT.drawing, status: "processed" as const }, sourceDownloadUrl: "https://example.test/source.dxf", sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z" };
  render(<DrawingDetail id={finding.drawingId} api={{ getDrawing: async () => result, processDrawing: async () => result }} initialTab="findings" />, { wrapper: wrapper() });
  await screen.findByText(finding.message);
  vi.mocked(fetchFindings).mockResolvedValue([]);
  act(() => bridge.props?.editor?.requestDelete(kind, "entity"));
  act(() => bridge.props?.editor?.deleteSelected());
  await screen.findByText("Порушень не знайдено");
  expect(fetchFindings).toHaveBeenCalledTimes(2);
});
