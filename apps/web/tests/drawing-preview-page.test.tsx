import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DrawingPreviewPage from "../app/drawing-preview/page";
import ProtectedLayout from "../app/(protected)/layout";

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims } })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect:/login"); }) }));
vi.mock("@/components/drawing/drawing-preview", () => ({ DrawingPreview: () => <div>Drawing preview</div> }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

beforeEach(() => { vi.clearAllMocks(); getClaims.mockResolvedValue({ data: null, error: null }); });
afterEach(() => vi.unstubAllEnvs());

it("opens the local preview in the application shell without Supabase in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(renderToStaticMarkup(await DrawingPreviewPage())).toBe("<main><div>Drawing preview</div></main>");
  expect(createClient).not.toHaveBeenCalled();
});

it.each([
  { data: null, error: null },
  { data: { claims: { sub: "test-user" } }, error: new Error("Invalid session") },
])("requires a valid session in production: %j", async (result) => {
  vi.stubEnv("NODE_ENV", "production");
  getClaims.mockResolvedValue(result);
  await expect(DrawingPreviewPage()).rejects.toThrow("redirect:/login");
  expect(getClaims).toHaveBeenCalledOnce();
  expect(redirect).toHaveBeenCalledWith("/login");
});

it("renders the preview in the application shell for an authenticated production user", async () => {
  vi.stubEnv("NODE_ENV", "production");
  getClaims.mockResolvedValue({ data: { claims: { sub: "test-user" } }, error: null });
  expect(renderToStaticMarkup(await DrawingPreviewPage())).toBe("<main><div>Drawing preview</div></main>");
  expect(getClaims).toHaveBeenCalledOnce();
  expect(redirect).not.toHaveBeenCalled();
});

it("keeps other protected routes authenticated in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  await expect(ProtectedLayout({ children: "Upload" })).rejects.toThrow("redirect:/login");
  expect(getClaims).toHaveBeenCalledOnce();
});
