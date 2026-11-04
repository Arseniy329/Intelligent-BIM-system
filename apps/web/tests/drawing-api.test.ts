import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingDetailResponse } from "@bim/contracts";
import { ApiAuthenticationError, ApiHttpError, createDrawing } from "@/lib/api";
import { drawingApi, drawingErrorMessage, downloadLink, fetchDrawingDownload, normalizeDrawingDetail, parseDrawing, parseJob, parseProcessingAccepted } from "@/lib/drawing/drawing-api";
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
it("POSTs to the real endpoint and distinguishes accepted from a job", async () => {
  const accepted = { drawing_id: id, status: "accepted", message: "Processing stub accepted." };
  fetchMock.mockResolvedValue(new Response(JSON.stringify(accepted), { status: 200 }));
  expect(await drawingApi.processDrawing(id)).toEqual({ drawingId: id, status: "accepted", message: accepted.message });
  expect(fetchMock.mock.calls[0][0].pathname).toBe(`/api/v1/drawings/${id}/process`);
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  expect(drawingApi.getJob).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(() => parseJob(accepted)).toThrow();
  expect(() => parseProcessingAccepted({ ...accepted, drawing_id: "other" }, id)).toThrow();
});
it("rejects mismatched IDs, absent data and invalid jobs", async () => {
  expect(() => parseDrawing(null, id)).toThrow();
  expect(() => parseDrawing(detail, "another-id")).toThrow();
  expect(() => parseDrawing({ ...DEMO_RESULT, rooms: [{ ...DEMO_RESULT.rooms[0], drawingId: "another-id" }] }, id)).toThrow();
  expect(() => parseJob({ id: "job", status: "invented" })).toThrow();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "job", drawingId: "other", status: "queued", errorMessage: null })));
  await expect(drawingApi.processDrawing(id)).rejects.toThrow("acceptance");
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
  expect(() => normalizeDrawingDetail({ ...rawDetail, status: "error" }, id)).toThrow();
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
