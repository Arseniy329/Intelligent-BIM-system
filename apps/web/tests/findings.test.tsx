// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "@bim/contracts";
import { FindingsPanel, type FindingsPanelProps } from "@/components/drawing/findings-panel";
import { FindingsOverlay } from "@/components/drawing/findings-overlay";
import { fetchFindings, findingTarget, FINDING_LABELS } from "@/lib/drawing/findings";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import { apiFetch, ApiHttpError } from "@/lib/api";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";

vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), apiFetch: vi.fn() }));
const base: Finding = { id: "f1", drawingId: "drawing", roomId: DEMO_RESULT.rooms[0].id, deviceId: null, ruleId: "database-id", severity: "critical", message: "Завеликий крок сповіщувачів", document: "ДБН (тест)", clause: "1.2", ruleStatus: "verified" };
const room = DEMO_RESULT.rooms[0];
const defaults: FindingsPanelProps = { findings: [base], rooms: DEMO_RESULT.rooms, devices: DEMO_RESULT.devices, selectedId: null, onSelect: vi.fn(), checked: true, retry: vi.fn() };
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("real findings client", () => {
  it("uses authenticated API transport, drawing path and abort signal", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify([base])));
    const signal = new AbortController().signal;
    expect(await fetchFindings("drawing", signal)).toEqual([base]);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/drawings/drawing/findings", { method: "GET", signal, cache: "no-store" });
  });
  it.each([401, 403, 500])("preserves HTTP %s as an error", async status => {
    vi.mocked(apiFetch).mockResolvedValue(new Response("error", { status }));
    await expect(fetchFindings("drawing")).rejects.toMatchObject({ statusCode: status });
  });
  it.each([{}, null, [{ ...base, drawingId: "other" }], [{ ...base, severity: "okay" }]])("rejects malformed responses", async payload => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(fetchFindings("drawing")).rejects.toThrow();
  });
  it("accepts an empty response but does not swallow network failure", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response("[]")).mockRejectedValueOnce(new TypeError("offline"));
    expect(await fetchFindings("drawing")).toEqual([]);
    await expect(fetchFindings("drawing")).rejects.toThrow("offline");
  });
});

describe("findings panel", () => {
  it.each(Object.entries(FINDING_LABELS))("renders %s independently", (severity, label) => {
    render(<FindingsPanel {...defaults} findings={[{ ...base, severity: severity as Finding["severity"] }]} />);
    const list = screen.getByRole("list", { name: "Список порушень" });
    expect(within(list).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(list).getByText(base.message)).toBeVisible();
    expect(within(list).getByText(room.name!)).toBeVisible();
  });
  it("handles absent associations and never invents a spatial target or clause", () => {
    render(<FindingsPanel {...defaults} findings={[{ ...base, roomId: null, deviceId: null, ruleId: null, clause: null, ruleStatus: null }]} />);
    expect(screen.getByText("Без прив’язки до приміщення")).toBeVisible();
    expect(screen.getByText("Місце на плані не визначено.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /пункт не підтверджено/ }));
    expect(screen.getByText("Посилання на правило не надано.")).toBeVisible();
    expect(screen.getByText(/Статус правила невідомий/)).toBeVisible();
  });
  it.each(["verified", "needs_review", "unknown"])("maps rule database ID and %s status", status => {
    render(<FindingsPanel {...defaults} findings={[{ ...base, ruleStatus: status === "unknown" ? null : status as Finding["ruleStatus"] }]}
      rules={[{ id: "database-id", rule: "Умова для офісу", value: "6 м", document: "ДБН (тест)", clause: "1.2", status }]} />);
    fireEvent.click(screen.getByRole("button", { name: "ДБН (тест) · 1.2" }));
    const details = screen.getByRole("region", { name: "Картка правила" });
    expect(within(details).getByText("6 м")).toBeVisible();
    expect(within(details).getAllByText("Умова для офісу")).toHaveLength(2);
    expect(within(details).getByText(status === "verified" ? "Перевірено" : status === "needs_review" ? "Треба перевірити" : /Статус правила невідомий/)).toBeVisible();
  });
  it("shows both conflict documents, clauses, zero/nonzero values and units", () => {
    render(<FindingsPanel {...defaults} findings={[{ ...base, severity: "rule_conflict", conflictDetails: { valueKind: "max_grid_spacing_m", rules: [
      { id: "a", document: "ДБН (тест)", clause: "1", value: 0, verificationStatus: "verified" },
      { id: "b", document: "ДСТУ (тест)", clause: "2", value: 7.5, verificationStatus: "needs_review" },
    ] } }]} />);
    const card = screen.getByRole("region", { name: "Конфлікт нормативних вимог" });
    for (const text of ["ДБН (тест)", "ДСТУ (тест)", "Пункт: 1", "Пункт: 2", "Значення: 0 м", "Значення: 7.5 м", "Потрібне рішення інженера"]) expect(within(card).getByText(text)).toBeVisible();
  });
  it.each([null, {}, { rules: [null, { document: "ДБН (тест)" }] }])("reports incomplete conflicts truthfully", conflictDetails => {
    render(<FindingsPanel {...defaults} findings={[{ ...base, severity: "rule_conflict", conflictDetails }]} />);
    expect(screen.getByText("Недостатньо даних для повного порівняння вимог.")).toBeVisible();
  });
  it("distinguishes loading, unchecked, empty and errors; supports retry", () => {
    const view = render(<FindingsPanel {...defaults} findings={[]} loading />);
    expect(screen.queryByText("Порушень не знайдено")).not.toBeInTheDocument();
    view.rerender(<FindingsPanel {...defaults} findings={[]} checked={false} />);
    expect(screen.getByText("Перевірку ще не завершено.")).toBeVisible();
    view.rerender(<FindingsPanel {...defaults} findings={[]} />);
    expect(screen.getByText("Порушень не знайдено")).toBeVisible();
    view.rerender(<FindingsPanel {...defaults} findings={[]} error={new ApiHttpError(403)} />);
    expect(screen.queryByText("Порушень не знайдено")).not.toBeInTheDocument();
    expect(screen.getByText("У вас немає доступу до цього креслення.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Повторити перевірку" }));
    expect(defaults.retry).toHaveBeenCalledOnce();
  });
  it("selects individual findings and exposes marker-selected rows through a filter", () => {
    const second: Finding = { ...base, id: "second", severity: "warning", message: "Інше зауваження" };
    const view = render(<FindingsPanel {...defaults} findings={[base, second]} />);
    fireEvent.click(screen.getByRole("button", { name: /Критичне · 1/ }));
    expect(screen.queryByText(second.message)).not.toBeInTheDocument();
    view.rerender(<FindingsPanel {...defaults} findings={[base, second]} selectedId="second" markerActivation={second} />);
    expect(screen.getByText(second.message)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(second.message) }));
    expect(defaults.onSelect).toHaveBeenCalledWith(second);
  });
});

describe("spatial selection", () => {
  it("uses actual device position; falls back to room; rejects missing or corrupt geometry", () => {
    const device = DEMO_RESULT.devices[0];
    expect(findingTarget({ ...base, deviceId: device.id }, DEMO_RESULT.rooms, [device])?.point).toEqual(device.position);
    expect(findingTarget(base, DEMO_RESULT.rooms, [])?.room?.id).toBe(room.id);
    expect(findingTarget({ ...base, roomId: null }, [], [])).toBeNull();
    expect(findingTarget(base, [{ ...room, polygon: [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }], [])).toBeNull();
  });
  it("keeps multiple findings on one element individually selectable without moving the camera on refresh", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const controller: DrawingViewportController = { worldToScreen: p => p, screenToWorld: p => p, getViewport: () => ({ center: { x: 0, y: 0 }, width: 100 }), subscribeViewportChange: () => () => {}, fitToDrawing: vi.fn(), zoomBy: vi.fn(), focusPoint: vi.fn() };
    const onSelect = vi.fn();
    const second = { ...base, id: "second", message: "Другий результат" };
    const view = render(<FindingsOverlay controller={controller} findings={[base, second]} rooms={DEMO_RESULT.rooms} devices={[]} onSelect={onSelect} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Другий результат/ }));
    expect(onSelect).toHaveBeenCalledWith(second);
    view.rerender(<FindingsOverlay controller={controller} findings={[second]} rooms={DEMO_RESULT.rooms} devices={[]} selectedId="second" onSelect={onSelect} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(controller.focusPoint).not.toHaveBeenCalled();
    expect(controller.fitToDrawing).not.toHaveBeenCalled();
  });
});
