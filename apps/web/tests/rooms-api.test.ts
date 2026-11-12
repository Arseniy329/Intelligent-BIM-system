import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateRoom } from "@/lib/rooms/rooms-api";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));
const fetchMock = vi.fn();

const mockRoomResponse = {
  id: "r1",
  drawing_id: "2dcbe698-7658-40c7-90f1-372e669b1277",
  name: "Office 101",
  type: "office",
  height: 3.2,
  area: 25.0,
  polygon: [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 5 },
    { x: 0, y: 5 },
  ],
  source: "auto",
  confirmed: true,
};

describe("updateRoom API - Clearing and Modifying Type (Issue 2 Regression)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
      error: null,
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockRoomResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("explicitly sends 'unknown' when room_type is set to 'unknown'", async () => {
    await updateRoom("r1", { room_type: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty("type", "unknown");
  });

  it("explicitly sends 'unknown' when room_type is set to null (clearing classification)", async () => {
    await updateRoom("r1", { room_type: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty("type", "unknown");
  });

  it("explicitly sends 'unknown' when type is set to 'unknown'", async () => {
    await updateRoom("r1", { type: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty("type", "unknown");
  });

  it("does not include 'type' when room_type and type are undefined (omitted)", async () => {
    await updateRoom("r1", { height: 2.8 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("type");
    expect(body).toHaveProperty("height", 2.8);
  });
});
