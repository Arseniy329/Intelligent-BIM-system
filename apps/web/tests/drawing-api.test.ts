import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingDetailResponse, ProcessingJob } from "@bim/contracts";
import { ApiAuthenticationError, ApiHttpError, createDrawing } from "@/lib/api";
import { type DrawingResponse, drawingApi, drawingErrorMessage, downloadLink, fetchDrawingDownload, listDrawings, normalizeDrawingDetail, parseDrawing, parseJob, parseDrawingOperation, parsePlacementReport, placementReport, processingErrorMessage } from "@/lib/drawing/drawing-api";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import { createDemoDrawingApi } from "@/lib/drawing/demo-api";
import { isDrawingDemoEnabled } from "@/lib/drawing/demo-mode";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));
const fetchMock = vi.fn();
const id = DEMO_RESULT.drawing.id;
const detail: DrawingDetailResponse = {
  id, ownerId: "owner", originalFileName: "plan.dxf", storagePath: "private/plan.dxf", units: "mm",
  status: "uploaded", createdAt: "2026-10-25T00:00:00Z", sourceDownloadUrl: "https://storage.example/source?signature=fresh",
  sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z",
};
const rawDetail = {
  id, owner_id: detail.ownerId, original_file_name: detail.originalFileName, storage_path: detail.storagePath,
  units: detail.units, status: detail.status, created_at: detail.createdAt,
  source_download_url: detail.sourceDownloadUrl, source_download_url_expires_at: detail.sourceDownloadUrlExpiresAt,
};
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "test-access-token" } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("GETs the requested ID through the existing authenticated API client", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(rawDetail)));
  const signal = new AbortController().signal;
  expect(await drawingApi.getDrawing(id, signal)).toEqual(detail);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url.toString()).toBe(`https://api.example/api/v1/drawings/${id}`);
  expect(init.signal).toBe(signal);
  expect(init.headers.get("Authorization")).toBe("Bearer test-access-token");
  expect(init.cache).toBe("no-store");
});
it("rejects a missing session before making a network request", async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(drawingApi.getDrawing(id)).rejects.toBeInstanceOf(ApiAuthenticationError);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([401, 403, 404, 409, 500, 501])("handles HTTP %s without exposing server response text", async status => {
  fetchMock.mockResolvedValue(new Response("private server diagnostic", { status }));
  const error = await drawingApi.getDrawing(id).catch(error => error);
  expect(error).toBeInstanceOf(ApiHttpError);
  expect(error.statusCode).toBe(status);
  expect(drawingErrorMessage(error)).not.toContain("private");
});
it("reports a network failure in Ukrainian", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  const error = await drawingApi.getDrawing(id).catch(error => error);
  expect(drawingErrorMessage(error)).toContain("Перевірте з’єднання");
});
it.each(["process", "place"] as const)("POSTs the synchronous %s endpoint without a job", async operation => {
  const status = operation === "process" ? "processing" : "processed";
  const response = { drawing_id: id, status };
  fetchMock.mockResolvedValue(new Response(JSON.stringify(response)));
  const method = operation === "process" ? drawingApi.processDrawing : drawingApi.placeDrawing!;
  expect(await method(id)).toEqual({ drawingId: id, status });
  expect(fetchMock.mock.calls[0][0].pathname).toBe(`/api/v1/drawings/${id}/${operation}`);
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  expect(drawingApi.getJob).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(() => parseDrawingOperation({ ...response, drawing_id: "other" }, id, status)).toThrow();
  expect(() => parseDrawingOperation({ drawing_id: id, status: "accepted" }, id, status)).toThrow();
});
it("keeps the placement report of POST /place: partial result with skipped zones and reasons", () => {
  const operation = parseDrawingOperation({
    drawing_id: id, status: "processed", placement_status: "partial", device_count: 6,
    placements: [{ status: "placed" }],
    skipped: [
      { room_id: "r1", zone_id: null, name: "Hall", zone_name: "Решта приміщення", scope: "remainder",
        reason: "Частину приміщення (≈40 м², 50 %) не віднесено до жодної зони: додайте зону з висотою для решти приміщення" },
      { room_id: "r2", zone_id: null, name: "Office", zone_name: null, scope: "room", reason: "Не введено висоту" },
    ],
  }, id, "processed");
  expect(operation).toMatchObject({ drawingId: id, status: "processed", placementStatus: "partial", deviceCount: 6 });
  expect(placementReport(operation)?.placementIssues).toEqual([
    { title: "Hall — Решта приміщення", reason: expect.stringContaining("не віднесено до жодної зони") },
    { title: "Office", reason: "Не введено висоту" },
  ]);
});
it("reports no devices because of missing height as insufficient data, not as a plain success", () => {
  const operation = parseDrawingOperation({
    drawing_id: id, status: "processed", placement_status: "insufficient_data", device_count: 0,
    skipped: [{ name: "Hall", zone_name: null, reason: "Не введено висоту" }],
  }, id, "processed");
  expect(placementReport(operation)).toMatchObject({ placementStatus: "insufficient_data", deviceCount: 0 });
  expect(placementReport(operation)?.placementIssues).toEqual([{ title: "Hall", reason: "Не введено висоту" }]);
});
it("ignores malformed placement report parts and responses without a report", () => {
  expect(parsePlacementReport({ placement_status: "invented", device_count: "3", skipped: [null, { reason: "" }, { name: "A" }] }))
    .toEqual({ placementIssues: [] });
  expect(placementReport(parseDrawingOperation({ drawing_id: id, status: "processed" }, id, "processed"))).toBeNull();
  expect(placementReport(DEMO_RESULT)).toBeNull();
  expect(placementReport(undefined)).toBeNull();
});
it("keeps the warnings of the process and place steps instead of dropping them", () => {
  const processed = parseDrawingOperation({
    drawing_id: id, status: "processing",
    exit_detection: { status: "failed", exits: null, passages: null, warning: "Раніше збережені виходи й проходи лишено без змін" },
  }, id, "processing");
  expect(placementReport(processed)?.warnings).toEqual(["Раніше збережені виходи й проходи лишено без змін"]);

  const placed = parseDrawingOperation({
    drawing_id: id, status: "processed", placement_status: "complete", device_count: 4,
    skipped: [],
    manual_call_points: {
      status: "placed", reason: null, warning: null,
      route_coverage: "unconfirmed", route_warning: "Шлях евакуації між виходами не підтверджено. Приміщення: East",
    },
  }, id, "processed");
  expect(placementReport(placed)).toMatchObject({ placementStatus: "complete" });
  expect(placementReport(placed)?.warnings).toEqual(["Ручні сповіщувачі: Шлях евакуації між виходами не підтверджено. Приміщення: East"]);
});
it("shows why manual call points were not placed and ignores responses without warnings", () => {
  const noExits = parseDrawingOperation({
    drawing_id: id, status: "processed", placement_status: "complete", device_count: 4,
    manual_call_points: { status: "insufficient_data", reason: "Позначте евакуаційні виходи", warning: null, route_warning: null },
  }, id, "processed");
  expect(placementReport(noExits)?.warnings).toEqual(["Ручні сповіщувачі: Позначте евакуаційні виходи"]);
  const clean = parseDrawingOperation({
    drawing_id: id, status: "processing", exit_detection: { status: "ok", exits: 2, passages: 1, warning: null },
  }, id, "processing");
  expect(placementReport(clean)).toBeNull();
  expect(clean).toEqual({ drawingId: id, status: "processing" });
});
it("surfaces sounder status separately and keeps it after a reload (BIM-76)", () => {
  // Випадок 1: димові complete, правила-відстані для оповіщувачів немає — причина
  // на рівні типу приладу, а не мовчазний пропуск.
  const noRule = {
    placement_status: "complete", device_count: 4, skipped: [],
    sounders: { placement_status: "insufficient_data", device_count: 0, needs_review: false,
      skipped: [{ name: "Hall", reason: "Немає правила розміщення для цього типу приладу" }] },
  };
  const warn1 = "Оповіщувачі не розміщено: Немає правила розміщення для цього типу приладу";
  expect(placementReport(parseDrawingOperation({ drawing_id: id, status: "processed", ...noRule }, id, "processed"))?.warnings).toContain(warn1);
  // Те саме зі збереженого звіту, який GET повертає після перезавантаження.
  expect(placementReport(parseDrawing({ ...DEMO_RESULT, placementReport: noRule }, id))?.warnings).toContain(warn1);

  // Випадок 2: розміщено лише в частині приміщень/зон.
  const partial = {
    placement_status: "partial", device_count: 3, skipped: [{ name: "X", reason: "Не введено висоту" }],
    sounders: { placement_status: "partial", device_count: 2, needs_review: true,
      skipped: [{ name: "X", reason: "Не введено висоту" }] },
  };
  expect(placementReport(parseDrawing({ ...DEMO_RESULT, placementReport: partial }, id))?.warnings)
    .toContain("Оповіщувачі: розміщено не в усіх приміщеннях чи зонах");

  // Випадок 3: усі розміщені, але за попереднім правилом (needs_review): `complete`
  // не означає, що акустичне покриття перевірено — попередження все одно є.
  const preliminary = {
    placement_status: "complete", device_count: 4, skipped: [],
    sounders: { placement_status: "complete", device_count: 3, skipped: [], needs_review: true },
  };
  const warn3 = placementReport(parseDrawing({ ...DEMO_RESULT, placementReport: preliminary }, id))?.warnings ?? [];
  expect(warn3.some(w => w.includes("крок розміщення попередній"))).toBe(true);
});
it("reads the stored placement report that GET returns with a result, so a reload keeps the reasons", () => {
  const stored = {
    placement_status: "partial", device_count: 6,
    skipped: [{ room_id: "r1", zone_id: null, name: "Hall", zone_name: "Решта приміщення", scope: "remainder",
      reason: "Частину приміщення (≈40 м², 50 %) не віднесено до жодної зони" }],
  };
  const result = parseDrawing({ ...DEMO_RESULT, placementReport: stored }, id);
  expect(placementReport(result)).toMatchObject({ placementStatus: "partial", deviceCount: 6 });
  expect(placementReport(result)?.placementIssues).toEqual([
    { title: "Hall — Решта приміщення", reason: expect.stringContaining("не віднесено до жодної зони") },
  ]);
  // The same wire shape as the POST /place acknowledgement gives the same report.
  expect(placementReport(result)).toEqual(parsePlacementReport(stored));
  expect(placementReport(parseDrawingOperation({ drawing_id: id, status: "processed", ...stored }, id, "processed")))
    .toEqual(placementReport(result));
});
it.each([null, "partial", {}, { placement_status: "invented" }])("treats a null or malformed stored report (%j) as no report and keeps the result valid", stored => {
  const result = parseDrawing({ ...DEMO_RESULT, placementReport: stored }, id);
  expect(placementReport(result)).toBeNull();
  expect(result).toMatchObject({ rooms: DEMO_RESULT.rooms, devices: DEMO_RESULT.devices });
  expect(result).not.toHaveProperty("placementReport");
});
it("keeps a result without a report as it is", () => {
  expect(parseDrawing(DEMO_RESULT, id)).toBe(DEMO_RESULT);
  expect(placementReport(parseDrawing(DEMO_RESULT, id))).toBeNull();
});
it("shows the stored step warnings after a reload, also when no device was placed yet", () => {
  // /process stores only the exit detection outcome; /place adds the manual call point outcome.
  const processed = parseDrawing({
    ...DEMO_RESULT,
    placementReport: { exit_detection: { status: "failed", exits: null, passages: null, warning: "Виходи не збережено: пошук виходів завершився помилкою" } },
  }, id);
  expect(placementReport(processed)).toEqual({ warnings: ["Виходи не збережено: пошук виходів завершився помилкою"] });

  const placed = parseDrawing({
    ...DEMO_RESULT,
    placementReport: {
      placement_status: "complete", device_count: 4, skipped: [],
      manual_call_points: { status: "placed", route_coverage: "unconfirmed", route_warning: "Прохід не прив'язано до двох приміщень" },
    },
  }, id);
  expect(placementReport(placed)).toEqual({
    placementStatus: "complete", deviceCount: 4, placementIssues: [],
    warnings: ["Ручні сповіщувачі: Прохід не прив'язано до двох приміщень"],
  });
});
it("reads the report from every response shape a mutation can hold, a processing job included", () => {
  const job = { id: "job", drawingId: id, status: "queued", errorMessage: null } as ProcessingJob;
  expect(placementReport(job)).toBeNull();
  expect(placementReport(detail as unknown as DrawingResponse)).toBeNull();
});
it("rejects mismatched IDs, absent data and invalid jobs", async () => {
  expect(() => parseDrawing(null, id)).toThrow();
  expect(() => parseDrawing(detail, "another-id")).toThrow();
  expect(() => parseDrawing({ ...DEMO_RESULT, rooms: [{ ...DEMO_RESULT.rooms[0], drawingId: "another-id" }] }, id)).toThrow();
  expect(() => parseJob({ id: "job", status: "invented" })).toThrow();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "job", drawingId: "other", status: "queued", errorMessage: null })));
  await expect(drawingApi.processDrawing(id)).rejects.toThrow("operation");
});
it.each(["https://api.example", "https://api.example/api/v1", "https://api.example/api/v1/"])("shares a single API prefix with BIM-62 for base %s", async base => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", base);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ drawing: rawDetail, upload: { url: "https://storage.example/upload", path: "test", expires_in_seconds: 3600 } })))
    .mockResolvedValueOnce(new Response(JSON.stringify(rawDetail)));
  const created = await createDrawing({ fileName: "plan.dxf", units: "from_file" });
  await drawingApi.getDrawing(created.drawing.id);
  expect(fetchMock.mock.calls.map(([url]) => url.pathname)).toEqual(["/api/v1/drawings", `/api/v1/drawings/${id}`]);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ original_file_name: "plan.dxf", units: "from_file" });
});
it("preserves failed and unresolved from_file units from FastAPI", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...rawDetail, status: "failed", units: "from_file" })));
  expect(await drawingApi.getDrawing(id)).toEqual({ ...detail, status: "failed", units: "from_file" });
  expect(normalizeDrawingDetail({ ...rawDetail, status: "error" }, id).status).toBe("error");
  expect(() => normalizeDrawingDetail({ ...rawDetail, units: "feet" }, id)).toThrow();
});
it("preserves unavailable source URLs without synthesizing a result", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...rawDetail, source_download_url: null })));
  expect(await drawingApi.getDrawing(id)).toEqual({ ...detail, sourceDownloadUrl: null });
});
it("accepts results, rooms without devices and empty results", () => {
  expect(parseDrawing(DEMO_RESULT, id)).toEqual(DEMO_RESULT);
  expect(parseDrawing({ ...DEMO_RESULT, devices: [] }, id)).toMatchObject({ devices: [] });
  expect(parseDrawing({ ...DEMO_RESULT, rooms: [], devices: [] }, id)).toMatchObject({ rooms: [], devices: [] });
});

it("reads DrawingResult from GET and accepts a contract result from POST", async () => {
  fetchMock.mockImplementation(async () => Response.json(DEMO_RESULT));
  expect(await drawingApi.getDrawing(id)).toEqual(DEMO_RESULT);
  expect(await drawingApi.processDrawing(id)).toEqual(DEMO_RESULT);
  expect(await drawingApi.placeDrawing!(id)).toEqual(DEMO_RESULT);
});
it("rejects malformed results and duplicate overlay identities", () => {
  for (const changes of [
    { rooms: [DEMO_RESULT.rooms[0], DEMO_RESULT.rooms[0]] },
    { devices: [DEMO_RESULT.devices[0], DEMO_RESULT.devices[0]] },
    { downloadUrl: { token: "private" } },
    { drawing: { ...DEMO_RESULT.drawing, resolvedUnits: "from_file" } },
    { rooms: [{ ...DEMO_RESULT.rooms[0], area: Infinity }] },
  ]) expect(() => parseDrawing({ ...DEMO_RESULT, ...changes }, id)).toThrow();
});
it("translates public processing errors and hides untrusted diagnostics", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "LayerNotFoundError", message: "private storage path" }, { status: 400 }));
  const error = await drawingApi.processDrawing(id).catch(error => error);
  expect(drawingErrorMessage(error)).toContain("FIRE_ROOMS");
  expect(processingErrorMessage("LayerNotFoundError")).toContain("FIRE_ROOMS");
  expect(processingErrorMessage("SQL password=secret token=private")).not.toMatch(/SQL|password|secret|private/);
});

describe("DXF download", () => {
  it("refreshes details before every download and does not forward API credentials to storage", async () => {
    const getDrawing = vi.fn(async () => detail);
    fetchMock.mockImplementation(async () => new Response("DXF contents"));
    const api = { ...drawingApi, getDrawing };
    expect((await fetchDrawingDownload(api, id, "source")).fileName).toBe("plan.dxf");
    await fetchDrawingDownload(api, id, "source");
    expect(getDrawing).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(detail.sourceDownloadUrl);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });
  it("downloads a generated result only from its own link", async () => {
    const result = { ...DEMO_RESULT, downloadUrl: "https://storage.example/generated", downloadUrlExpiresAt: detail.sourceDownloadUrlExpiresAt };
    fetchMock.mockResolvedValue(new Response("generated DXF"));
    const file = await fetchDrawingDownload({ ...drawingApi, getDrawing: async () => result }, id, "result");
    expect(fetchMock.mock.calls[0][0]).toBe(result.downloadUrl);
    expect(file.fileName).toMatch(/-processed\.dxf$/);
    expect(() => downloadLink(detail, "result")).toThrow("недоступне");
    expect(() => downloadLink(result, "source")).toThrow("недоступне");
  });
  it.each([null, "", "invalid", "2000-01-01T00:00:00Z"])("rejects an absent/expired expiry: %s", expires => {
    expect(() => downloadLink({ ...detail, sourceDownloadUrlExpiresAt: expires }, "source")).toThrow("Термін");
  });
  it("rejects missing and unsafe URLs", () => {
    expect(() => downloadLink({ ...detail, sourceDownloadUrl: null }, "source")).toThrow("недоступне");
    expect(() => downloadLink({ ...detail, sourceDownloadUrl: "javascript:alert(1)" }, "source")).toThrow("некоректне");
  });
  it.each([403, 500])("reports file HTTP %s", async status => {
    fetchMock.mockResolvedValue(new Response("", { status }));
    await expect(fetchDrawingDownload({ ...drawingApi, getDrawing: async () => detail }, id, "source")).rejects.toThrow();
  });
  it("rejects an empty download", async () => {
    fetchMock.mockResolvedValue(new Response(""));
    await expect(fetchDrawingDownload({ ...drawingApi, getDrawing: async () => detail }, id, "source")).rejects.toThrow("порожній");
  });
});

describe("explicit local demo", () => {
  it.each(["development", "test"])("runs without a backend in %s when enabled", async environment => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("NEXT_PUBLIC_DRAWING_DEMO", "true");
    vi.useFakeTimers();
    const api = createDemoDrawingApi("blob:http://localhost/fixture");
    expect(await api.getDrawing("demo-empty")).toMatchObject({ status: "uploaded" });
    const job = await api.processDrawing("demo-empty");
    await expect(api.processDrawing("demo-empty")).rejects.toMatchObject({ statusCode: 409 });
    expect(await api.getJob(job.id)).toMatchObject({ status: "queued" });
    vi.advanceTimersByTime(1600);
    expect(await api.getJob(job.id)).toMatchObject({ status: "completed" });
    expect(await api.getDrawing("demo-empty")).toMatchObject({ rooms: [], devices: [], downloadUrl: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps room-only results separate from another drawing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DRAWING_DEMO", "true");
    vi.useFakeTimers();
    const api = createDemoDrawingApi("blob:http://localhost/fixture");
    await api.getDrawing("demo-no-devices");
    const job = await api.processDrawing("demo-no-devices");
    vi.advanceTimersByTime(1600);
    await api.getJob(job.id);
    expect(await api.getDrawing("demo-no-devices")).toMatchObject({ rooms: DEMO_RESULT.rooms.map(room => ({ ...room, drawingId: "demo-no-devices" })), devices: [] });
    expect(await api.getDrawing("demo-uploaded")).toMatchObject({ status: "uploaded" });
  });
  it.each(["production", "development"])("does not silently enable mocks in %s", environment => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("NEXT_PUBLIC_DRAWING_DEMO", environment === "production" ? "true" : "false");
    expect(isDrawingDemoEnabled()).toBe(false);
    expect(() => createDemoDrawingApi("blob:http://localhost/fixture")).toThrow("disabled");
    expect(() => downloadLink({ ...detail, sourceDownloadUrl: "blob:http://localhost/fixture" }, "source")).toThrow();
  });
});

describe("listDrawings", () => {
  it("maps snake_case list records to the DrawingListItem shape", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: "d-1", filename: "plan.dxf", created_at: "2026-11-01T10:00:00Z", status: "pending" },
      { id: "d-2", filename: "done.dxf", created_at: "2026-11-02T11:30:00Z", status: "done" },
    ])));

    expect(await listDrawings()).toEqual([
      { id: "d-1", filename: "plan.dxf", createdAt: "2026-11-01T10:00:00Z", status: "pending" },
      { id: "d-2", filename: "done.dxf", createdAt: "2026-11-02T11:30:00Z", status: "done" },
    ]);
  });

  it("accepts a { items: [...] } envelope", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      items: [
        { id: "d-3", filename: "wrapped.dxf", created_at: "2026-11-03T12:00:00Z", status: "processing" },
      ],
    })));

    expect(await listDrawings()).toEqual([
      { id: "d-3", filename: "wrapped.dxf", createdAt: "2026-11-03T12:00:00Z", status: "processing" },
    ]);
  });

  it("sends the Authorization header to the drawings endpoint", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([])));

    await listDrawings();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.pathname).toBe("/api/v1/drawings");
    expect(init.headers.get("Authorization")).toBe("Bearer test-access-token");
  });

  it("throws an error whose message contains the status code on a 500 response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Internal error" }), { status: 500 }));

    await expect(listDrawings()).rejects.toThrow(/500/);
  });
});
