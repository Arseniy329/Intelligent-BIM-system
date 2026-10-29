import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingDetailResponse } from "@bim/contracts";
import { ApiAuthenticationError } from "@/lib/api";
import { drawingApi, DrawingApiError, drawingErrorMessage, downloadLink, fetchDrawingDownload, parseDrawing, parseJob } from "@/lib/drawing/drawing-api";
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
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example/v1");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "test-access-token" } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("GETs the requested ID through the existing authenticated API client", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(detail)));
  const signal = new AbortController().signal;
  expect(await drawingApi.getDrawing(id, signal)).toEqual(detail);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url.toString()).toBe(`https://api.example/v1/drawings/${id}`);
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
  expect(error).toBeInstanceOf(DrawingApiError);
  expect(error.status).toBe(status);
  expect(drawingErrorMessage(error)).not.toContain("private");
});
it("reports a network failure in Ukrainian", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  const error = await drawingApi.getDrawing(id).catch(error => error);
  expect(drawingErrorMessage(error)).toContain("Перевірте з’єднання");
});
it("POSTs processing and GETs only the documented job endpoint", async () => {
  const job = { id: "job-1", drawingId: id, status: "queued", errorMessage: null };
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(job)));
  expect(await drawingApi.processDrawing(id)).toEqual(job);
  expect(fetchMock.mock.calls[0][0].pathname).toBe(`/v1/drawings/${id}/process`);
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  expect(await drawingApi.getJob("job-1")).toEqual(job);
  expect(fetchMock.mock.calls[1][0].pathname).toBe("/v1/processing-jobs/job-1");
});
it("rejects mismatched IDs, absent data and invalid jobs", async () => {
  expect(() => parseDrawing(null, id)).toThrow();
  expect(() => parseDrawing(detail, "another-id")).toThrow();
  expect(() => parseDrawing({ ...DEMO_RESULT, rooms: [{ ...DEMO_RESULT.rooms[0], drawingId: "another-id" }] }, id)).toThrow();
  expect(() => parseJob({ id: "job", status: "invented" })).toThrow();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "job", drawingId: "other", status: "queued", errorMessage: null })));
  await expect(drawingApi.processDrawing(id)).rejects.toThrow("another drawing");
});
it("accepts results, rooms without devices and empty results", () => {
  expect(parseDrawing(DEMO_RESULT, id)).toEqual(DEMO_RESULT);
  expect(parseDrawing({ ...DEMO_RESULT, devices: [] }, id)).toMatchObject({ devices: [] });
  expect(parseDrawing({ ...DEMO_RESULT, rooms: [], devices: [] }, id)).toMatchObject({ rooms: [], devices: [] });
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
    await expect(api.processDrawing("demo-empty")).rejects.toMatchObject({ status: 409 });
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
