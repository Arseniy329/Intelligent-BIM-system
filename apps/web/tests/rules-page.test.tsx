// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RulesPage from "@/app/(protected)/rules/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

const RULES_CONTRACT_FIXTURE = {
  items: [
    {
      id: "rule-1",
      rule: "Мінімальна ширина шляхів евакуації",
      value: "1,2 м",
      room_type: "коридор",
      room_height_min: 2.5,
      room_height_max: 4,
      document: "ДБН В.2.2-40:2018",
      clause: "5.1",
      link: "https://example.gov.ua/dbn",
      status: "verified",
      checked_at: "2026-10-20T10:00:00Z",
    },
  ],
  total: 1,
};

interface MockRenderResult {
  queryClient: QueryClient;
}

function renderRulesPage(): MockRenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RulesPage />
    </QueryClientProvider>,
  );

  return { queryClient };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RulesPage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.bim.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "mock-token-xyz" } },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("loads and renders rules from the GET /api/v1/rules contract fixture", async () => {
    fetchMock.mockResolvedValue(jsonResponse(RULES_CONTRACT_FIXTURE));

    renderRulesPage();

    expect(
      await screen.findByText("Мінімальна ширина шляхів евакуації"),
    ).toBeInTheDocument();
    expect(screen.getByText("1,2 м")).toBeInTheDocument();
    expect(screen.getByText("ДБН В.2.2-40:2018")).toBeInTheDocument();
    expect(screen.getByText("Перевірено")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://api.bim.example/api/v1/rules");
    expect(init.method).toBe("GET");
    expect(init.headers.get("Accept")).toBe("application/json");
    expect(init.headers.get("Authorization")).toBe("Bearer mock-token-xyz");
  });

  it("shows the error state and retries the request from the UI", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ detail: "rules backend unavailable" }, 500),
      )
      .mockResolvedValueOnce(jsonResponse(RULES_CONTRACT_FIXTURE));

    renderRulesPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("rules backend unavailable");

    fireEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(
      await screen.findByText("Мінімальна ширина шляхів евакуації"),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
