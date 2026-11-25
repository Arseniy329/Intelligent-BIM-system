// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import type { DrawingViewerProps } from "@/components/drawing/drawing-viewer";
import { DrawingToolbar } from "@/components/drawing/drawing-toolbar";

vi.mock("@/components/drawing/drawing-viewer", () => ({ DrawingViewer: (props: DrawingViewerProps) => <div>
  <DrawingToolbar disabled={false} mode={props.mode} modeDisabled={props.editor?.blocked} onModeChange={props.onModeChange} onZoomIn={() => {}} onZoomOut={() => {}} onFit={() => {}} />
  {props.workPanel}
</div> }));
afterEach(cleanup);

async function setup() {
  const api = {
    getDrawing: vi.fn().mockResolvedValue({ ...DEMO_RESULT, sourceDownloadUrl: "https://storage.example/source.dxf", sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z" }),
    processDrawing: vi.fn().mockResolvedValue(DEMO_RESULT),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DrawingDetail id={DEMO_RESULT.drawing.id} api={api} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Прилади" }));
  await screen.findByRole("button", { name: "Додати прилад" });
  return api;
}

it("keeps save/cancel reachable when the placement banner is clicked during a draft", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "Додати прилад" }));
  const banner = screen.getByRole("button", { name: "Перейти до приміщень →" });
  expect(banner).toBeDisabled();
  fireEvent.click(banner);
  expect(screen.getByRole("tab", { name: "План" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Зберегти зміни" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Кімнати" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Скасувати всі зміни" }));
  expect(screen.getByRole("button", { name: "Додати прилад" })).toBeEnabled();
});

it("blocks a previously opened reprocessing confirmation until the draft is cancelled", async () => {
  const api = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Обробити повторно" }));
  fireEvent.click(screen.getByRole("button", { name: "Додати прилад" }));
  const confirm = screen.getByRole("button", { name: "Підтвердити повторну обробку" });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(api.processDrawing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Скасувати всі зміни" }));
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.processDrawing).toHaveBeenCalledOnce());
});
