// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DrawingCanvas from "@/components/drawing/drawing-canvas";
import { INITIAL_PLAN_LAYERS, PlanLayersPanel } from "@/components/drawing/plan-layers";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";

const { adapter, listeners } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let width = 100;
  return { listeners, adapter: {
    load: vi.fn().mockImplementation(async () => { width = 100; }), dispose: vi.fn(),
    getViewport: () => ({ width, center: { x: 0, y: 0 } }),
    zoomBy: (factor: number) => { width /= factor; listeners.forEach(listener => listener()); },
    fitToDrawing: () => { width = 100; listeners.forEach(listener => listener()); },
    worldToScreen: (point: { x: number; y: number }) => point,
    screenToWorld: (point: { x: number; y: number }) => point,
    subscribeViewportChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } };
});
vi.mock("@/lib/drawing/viewer-adapter", () => ({ createDrawingViewerAdapter: () => adapter }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("toggles a device type and room mode without reloading the file or resetting zoom", async () => {
  function Workspace() {
    const [layers, setLayers] = useState(INITIAL_PLAN_LAYERS);
    const [mode, setMode] = useState<"rooms" | "devices">("rooms");
    return <><DrawingCanvas url="fixture.dxf" onRetry={() => {}} rooms={DEMO_RESULT.rooms} devices={DEMO_RESULT.devices} layers={layers} mode={mode} onModeChange={setMode} onSelectRoom={() => {}} />
      <PlanLayersPanel rooms={DEMO_RESULT.rooms} devices={DEMO_RESULT.devices} value={layers} onChange={setLayers} /></>;
  }
  const view = render(<Workspace />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Збільшити масштаб" })).toBeEnabled());
  expect(screen.getByRole("button", { name: /^Димовий сповіщувач/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Збільшити масштаб" }));
  expect(screen.getByLabelText("Масштаб")).toHaveTextContent("125%");
  fireEvent.click(screen.getByRole("checkbox", { name: /Сповіщувачі/ }));
  expect(screen.queryByRole("button", { name: /^Димовий сповіщувач/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Тепловий сповіщувач/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Прилади" }));
  expect(screen.queryByRole("button", { name: /^Вибрати: Приміщення/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Масштаб")).toHaveTextContent("125%");
  expect(adapter.load).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Вмістити все" }));
  expect(screen.getByLabelText("Масштаб")).toHaveTextContent("100%");
  act(() => view.unmount());
  expect(listeners.size).toBe(0);
  expect(adapter.dispose).toHaveBeenCalledOnce();
});

it("keeps zoom percent accurate when parent re-renders with a new onReady callback", async () => {
  function Parent({ tick }: { tick: number }) {
    return <DrawingCanvas url="fixture.dxf" onRetry={() => {}} onReady={() => { void tick; }} rooms={DEMO_RESULT.rooms} devices={DEMO_RESULT.devices} />;
  }
  const view = render(<Parent tick={0} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Збільшити масштаб" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Збільшити масштаб" }));
  expect(screen.getByLabelText("Масштаб")).toHaveTextContent("125%");
  view.rerender(<Parent tick={1} />);
  fireEvent.click(screen.getByRole("button", { name: "Зменшити масштаб" }));
  expect(screen.getByLabelText("Масштаб")).toHaveTextContent("100%");
});
