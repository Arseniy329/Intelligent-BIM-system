import { afterEach, expect, it, vi } from "vitest";
import { planFeaturesApi } from "@/lib/drawing/plan-features-api";
import { apiFetch } from "@/lib/api";
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), apiFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("reads restored zones/exits and writes to the existing BIM-73 and BIM-75 routes", async () => {
  const fetch = vi.mocked(apiFetch).mockImplementation(async () => Response.json([]));
  await planFeaturesApi.zones("drawing"); await planFeaturesApi.exits("drawing");
  const body = { name: "Зона", height: 4, polygon: [{x:0,y:0},{x:1,y:0},{x:1,y:1}] };
  await planFeaturesApi.createZone("room", body); await planFeaturesApi.updateZone("zone", body);
  await planFeaturesApi.createExit("drawing", {name:null, position:{x:0,y:1}});
  expect(fetch.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
    ["/api/v1/drawings/drawing/zones", "GET"], ["/api/v1/drawings/drawing/exits", "GET"],
    ["/api/v1/rooms/room/zones", "POST"], ["/api/v1/zones/zone", "PATCH"], ["/api/v1/drawings/drawing/exits", "POST"],
  ]);
  expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual(body);
  fetch.mockResolvedValue(new Response(null, {status:204}));
  await expect(planFeaturesApi.deleteExit("exit")).resolves.toBeUndefined();
  await expect(planFeaturesApi.deleteZone("zone")).resolves.toBeUndefined();
});
it("does not disguise malformed responses or HTTP errors as no exits", async () => {
  const fetch = vi.mocked(apiFetch).mockResolvedValue(Response.json({items:[]}));
  await expect(planFeaturesApi.exits("drawing")).rejects.toThrow("некоректний список");
  fetch.mockResolvedValue(Response.json({detail:"zones of one room must not overlap"}, {status:422}));
  await expect(planFeaturesApi.createZone("room", {name:null,height:3,polygon:[]})).rejects.toThrow("не повинні перекриватися");
});
