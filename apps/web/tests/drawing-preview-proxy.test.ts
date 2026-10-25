import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import { updateSession } from "@/lib/supabase/proxy";

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn(() => NextResponse.next()) }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

it("bypasses the session for /drawing-preview in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const response = await proxy(new NextRequest("http://localhost/drawing-preview"));
  expect(response.status).toBe(200);
  expect(updateSession).not.toHaveBeenCalled();
});

it("updates the session for /drawing-preview in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const request = new NextRequest("http://localhost/drawing-preview");
  await proxy(request);
  expect(updateSession).toHaveBeenCalledExactlyOnceWith(request);
});

describe.each(["development", "production"])("other routes in %s", (environment) => {
  it.each(["/", "/upload", "/drawing-preview/private"])("updates the session for %s", async (pathname) => {
    vi.stubEnv("NODE_ENV", environment);
    const request = new NextRequest(`http://localhost${pathname}`);
    await proxy(request);
    expect(updateSession).toHaveBeenCalledExactlyOnceWith(request);
  });
});
