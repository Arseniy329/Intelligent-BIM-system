"use client";

import { useEffect, useRef, useState } from "react";
import { createDrawingViewerAdapter, type DrawingViewerAdapter } from "@/lib/drawing/viewer-adapter";
import { LOAD_PHASE_LABELS, logDrawingLoadTimings, measureDrawingLoad, type DrawingLoadTimings } from "@/lib/drawing/load-timings";
import type { DrawingViewerProps } from "./drawing-viewer";
import { DrawingToolbar } from "./drawing-toolbar";
import { DrawingOverlay } from "./drawing-overlay";
import styles from "./drawing-viewer.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; timings: DrawingLoadTimings; controller: DrawingViewerAdapter }
  | { status: "error"; message: string; timings?: DrawingLoadTimings };

export default function DrawingCanvas({
  url, onReady, onRetry, retryPending = false, rooms, devices, initialRoomLabelsVisible = true,
}: DrawingViewerProps & { onRetry: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<DrawingViewerAdapter | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [showRooms, setShowRooms] = useState(true);
  const [showDevices, setShowDevices] = useState(true);
  const [showRoomLabels, setShowRoomLabels] = useState(initialRoomLabelsVisible);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let adapter: DrawingViewerAdapter | undefined;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      cancelled = true;
      adapter?.dispose();
      setState({ status: "error", message: "Втрачено WebGL-контекст. Спробуйте відкрити креслення знову." });
    };
    host.addEventListener("webglcontextlost", onContextLost, true);

    async function load() {
      let measurement: ReturnType<typeof measureDrawingLoad> | undefined;
      let rendererInitMs = 0;
      try {
        const initStarted = performance.now();
        adapter = createDrawingViewerAdapter(host!);
        rendererInitMs = performance.now() - initStarted;
        adapterRef.current = adapter;
        measurement = measureDrawingLoad();
        await adapter.load(url, measurement.progress);
        const timings = measurement.finish(rendererInitMs, cancelled ? "cancelled" : "ready");
        logDrawingLoadTimings(timings);
        if (!cancelled) setState({ status: "ready", timings, controller: adapter });
      } catch (error) {
        const timings = measurement?.finish(rendererInitMs, cancelled ? "cancelled" : "error");
        logDrawingLoadTimings(timings);
        adapter?.dispose();
        if (!cancelled) {
          setState({
            status: "error",
            timings,
            message: error instanceof Error && error.message.startsWith("WebGL")
              ? error.message
              : "Не вдалося відкрити DXF. Перевірте файл або доступність посилання.",
          });
        }
      }
    }
    // Strict Mode replays effects in development. Cancel its throwaway mount
    // before creating WebGL resources or starting a non-abortable DXF load.
    const loadTask = window.setTimeout(() => { void load(); }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(loadTask);
      host.removeEventListener("webglcontextlost", onContextLost, true);
      adapter?.dispose();
      adapterRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (state.status !== "ready" || !adapterRef.current) return;
    onReady?.(adapterRef.current);
    return () => { onReady?.(null); };
  }, [state.status, onReady]);

  return (
    <>
      <DrawingToolbar
        disabled={state.status !== "ready"}
        onZoomIn={() => adapterRef.current?.zoomBy(1.25)}
        onZoomOut={() => adapterRef.current?.zoomBy(0.8)}
        onFit={() => adapterRef.current?.fitToDrawing()}
        roomsLayer={rooms?.length ? { visible: showRooms, toggle: () => setShowRooms((value) => !value) } : undefined}
        devicesLayer={devices?.length ? { visible: showDevices, toggle: () => setShowDevices((value) => !value) } : undefined}
        roomLabels={rooms?.length ? { visible: showRoomLabels, toggle: () => setShowRoomLabels((value) => !value) } : undefined}
      />
      <div className={styles.stage} aria-busy={state.status === "loading"}>
        <div ref={hostRef} className={styles.canvas} aria-label="Полотно DXF" />
        {state.status === "ready" && (rooms?.length || devices?.length) ? (
          <DrawingOverlay controller={state.controller} rooms={rooms} devices={devices}
            showRooms={showRooms} showDevices={showDevices} showRoomLabels={showRoomLabels} />
        ) : null}
        {state.status === "loading" && (
          <div className={styles.message} role="status">Завантаження креслення…</div>
        )}
        {state.status === "error" && (
          <div className={styles.message} role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={onRetry} disabled={retryPending}>
              {retryPending ? "Оновлення посилання…" : "Спробувати знову"}
            </button>
          </div>
        )}
      </div>
      {state.status === "ready" && showRooms && !!rooms?.length && (
        <ul className={styles.roomSummary} aria-label="Назви та площі приміщень">
          {rooms.map((room) => <li key={room.id}>
            <span>{room.name?.trim() || "Приміщення без назви"}</span>
            {" · "}{Number.isFinite(room.area) && room.area >= 0
              ? `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(room.area)} м²` : "Площу не визначено"}
          </li>)}
        </ul>
      )}
      <p className={styles.status} role="status">
        {state.status === "ready" ? "Креслення готове до перегляду." :
          state.status === "error" ? "Помилка відкриття креслення." : "Завантаження…"}
      </p>
      {state.status !== "loading" && state.timings && (
        <details className="px-3 pb-3 text-sm">
          <summary className="cursor-pointer">Діагностика завантаження</summary>
          <p>Ініціалізація renderer: {state.timings.rendererInitMs.toFixed(1)} мс</p>
          <p>Завантаження до {state.timings.outcome === "ready" ? "готовності" : "помилки"}: {state.timings.loadMs.toFixed(1)} мс</p>
          <ul className="list-inside list-disc">
            {Object.entries(state.timings.phases).map(([phase, ms]) => (
              <li key={phase}>{LOAD_PHASE_LABELS[phase as keyof typeof LOAD_PHASE_LABELS]}: {ms.toFixed(1)} мс</li>
            ))}
          </ul>
          <p>Запитів шрифту бібліотекою: {state.timings.fontRequests} (можливий HTTP-кеш).</p>
          <p>Інтервали performance.now() за progress API. Останній етап сумарний; окремий час GPU не вимірюється. При помилці інтервали часткові.</p>
        </details>
      )}
    </>
  );
}
