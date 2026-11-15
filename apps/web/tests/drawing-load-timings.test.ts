import { afterEach, describe, expect, it, vi } from "vitest";
import { logDrawingLoadTimings, measureDrawingLoad, type DrawingLoadTimings } from "@/lib/drawing/load-timings";

afterEach(() => vi.restoreAllMocks());

describe("drawing diagnostics privacy", () => {
  it.each(["ready", "error", "cancelled"] as const)("keeps metrics without leaking extra fields for %s", (outcome) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const timings = {
      outcome, rendererInitMs: 5, loadMs: 100, fontRequests: 1,
      phases: { read: 10, parse: 20, font: 5, prepareAndRender: 65,
        url: "https://example.test/file.dxf?token=secret" },
      url: "https://example.test/file.dxf?token=secret",
      accessToken: "secret",
      error: new Error("Authorization: Bearer secret"),
    };
    logDrawingLoadTimings(timings);
    expect(log).toHaveBeenCalledExactlyOnceWith("[DrawingViewer load]", {
      outcome, rendererInitMs: 5, loadMs: 100, fontRequests: 1,
      phases: { read: 10, parse: 20, font: 5, prepareAndRender: 65 },
    });
  });

  it("does not forward unexpected strings even in metric or outcome fields", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logDrawingLoadTimings({ outcome: "Bearer secret", rendererInitMs: "secret",
      loadMs: "https://example.test/file.dxf?token=secret", fontRequests: Infinity,
      phases: { read: "secret", parse: NaN },
    } as unknown as DrawingLoadTimings);
    expect(log).toHaveBeenCalledExactlyOnceWith("[DrawingViewer load]", {
      outcome: "error", rendererInitMs: undefined, loadMs: undefined,
      fontRequests: undefined, phases: {},
    });
  });

  it("logs safely when viewer initialization failed before timing started", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logDrawingLoadTimings();
    expect(log).toHaveBeenCalledExactlyOnceWith("[DrawingViewer load]", {
      outcome: "error", rendererInitMs: undefined, loadMs: undefined,
      fontRequests: undefined, phases: {},
    });
  });
});

describe("DXF load timing boundaries", () => {
  it("counts chunk reading, parsing and repeated scene/font intervals without claiming GPU time", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const measurement = measureDrawingLoad();
    now = 10;
    measurement.progress("fetch", 100, 200);
    now = 20;
    measurement.progress("parse", 0, 0);
    now = 50;
    measurement.progress("prepare", 0, 0);
    now = 70;
    measurement.progress("font", 0, 0);
    now = 80;
    measurement.progress("prepare", 0, 0);
    now = 90;
    measurement.progress("prepare", 0, 0);
    now = 100;
    measurement.progress("font", 0, 0);
    now = 115;
    measurement.progress("prepare", 0, 0);
    now = 150;
    expect(measurement.finish(5, "ready")).toEqual({
      outcome: "ready", rendererInitMs: 5, loadMs: 150, fontRequests: 2,
      phases: { read: 20, parse: 30, font: 25, prepareAndRender: 75 },
    });
  });

  it("reports partial failed or discarded attempts without fabricating missing phases", () => {
    for (const outcome of ["error", "cancelled"] as const) {
      vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(25);
      const measurement = measureDrawingLoad();
      expect(measurement.finish(2, outcome)).toEqual({
        outcome, rendererInitMs: 2, loadMs: 15, fontRequests: 0, phases: { read: 15 },
      });
      vi.restoreAllMocks();
    }
  });
});
