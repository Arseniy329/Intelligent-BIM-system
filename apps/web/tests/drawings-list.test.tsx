// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent, ReactNode } from "react";
import type { NormalizedDrawingRecord } from "@/lib/api";
import {
  ApiAuthenticationError,
  ApiHttpError,
  listDrawings,
  normalizeDrawingRecord,
} from "@/lib/api";
import type { DrawingListItem } from "@/lib/drawing/drawing-api";
import {
  DrawingStatusBadge,
  DrawingsList,
  formatUkrainianDate,
} from "@/components/drawings/drawings-list";
import DrawingsPage from "@/app/(protected)/drawings/page";
import { AppHeader } from "@/components/app-header";

// Mock Supabase client for listDrawings tests
const { getSession, routerPush } = vi.hoisted(() => ({
  getSession: vi.fn(),
  routerPush: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/drawings",
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<
      HTMLAnchorElement,
      {
        href: string | { pathname?: string };
        onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
        children?: ReactNode;
        className?: string;
        "data-testid"?: string;
        "data-status"?: string;
      }
    >(function MockLink(
      {
        href,
        onClick,
        children,
        className,
        "data-testid": testId,
        "data-status": dataStatus,
      },
      ref,
    ) {
      const hrefValue = typeof href === "string" ? href : href.pathname ?? "";
      return (
        <a
          ref={ref}
          href={hrefValue}
          className={className}
          data-testid={testId}
          data-status={dataStatus}
          onClick={(event) => {
            onClick?.(event);
            if (event.defaultPrevented) {
              return;
            }
            event.preventDefault();
            routerPush(hrefValue);
          }}
        >
          {children}
        </a>
      );
    }),
  };
});

vi.mock("@/components/ui/error-toast-provider", () => ({
  useErrorToast: () => ({ showErrorToast: vi.fn() }),
}));

// Mock useQuery for component rendering tests
const { queryState } = vi.hoisted(() => ({
  queryState: {
    value: {
      data: undefined as NormalizedDrawingRecord[] | undefined,
      isLoading: false,
      isError: false,
      error: null as unknown,
      isFetching: false,
      refetch: vi.fn(),
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.value,
}));

const mockDrawings: NormalizedDrawingRecord[] = [
  {
    id: "draw-1",
    ownerId: "user-secret-123",
    originalFileName: "office_floor_1.dxf",
    storagePath: "private/storage/draw-1.dxf",
    units: "mm",
    status: "processed",
    createdAt: "2026-10-25T14:30:00.000Z",
  },
  {
    id: "draw-2",
    ownerId: "user-secret-123",
    originalFileName: "warehouse_plan.dxf",
    storagePath: "private/storage/draw-2.dxf",
    units: "m",
    status: "processing",
    createdAt: "2026-10-26T09:15:00.000Z",
  },
  {
    id: "draw-3",
    ownerId: "user-secret-123",
    originalFileName: "hotel_complex.dxf",
    storagePath: "private/storage/draw-3.dxf",
    units: "mm",
    status: "uploaded",
    createdAt: "2026-10-27T18:00:00.000Z",
  },
  {
    id: "draw-4",
    ownerId: "user-secret-123",
    originalFileName: "parking_lot.dxf",
    storagePath: "private/storage/draw-4.dxf",
    units: "from_file",
    status: "failed",
    createdAt: "2026-10-28T11:00:00.000Z",
  },
  {
    id: "draw-5",
    ownerId: "user-secret-123",
    originalFileName: "shopping_mall.dxf",
    storagePath: "private/storage/draw-5.dxf",
    units: "mm",
    status: "pending",
    createdAt: "2026-10-29T08:00:00.000Z",
  },
  {
    id: "draw-6",
    ownerId: "user-secret-123",
    originalFileName: "corrupted_archive.dxf",
    storagePath: "private/storage/draw-6.dxf",
    units: "mm",
    status: "error",
    createdAt: "2026-10-29T12:00:00.000Z",
  },
];

describe("listDrawings API utility", () => {
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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends authenticated GET to /api/v1/drawings and normalizes snake_case records", async () => {
    const rawBackendData = [
      {
        id: "d-1",
        owner_id: "owner-1",
        original_file_name: "plan_a.dxf",
        storage_path: "storage/d-1.dxf",
        units: "mm",
        status: "processed",
        created_at: "2026-10-29T10:00:00Z",
      },
      {
        id: "d-2",
        owner_id: "owner-1",
        original_file_name: "plan_b.dxf",
        storage_path: "storage/d-2.dxf",
        units: "m",
        status: "failed",
        created_at: "2026-10-29T11:00:00Z",
      },
    ];

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(rawBackendData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const controller = new AbortController();
    const result = await listDrawings(controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://api.bim.example/api/v1/drawings");
    expect(init.method).toBe("GET");
    expect(init.headers.get("Authorization")).toBe("Bearer mock-token-xyz");
    expect(init.headers.get("Accept")).toBe("application/json");
    expect(init.signal).toBe(controller.signal);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "d-1",
      ownerId: "owner-1",
      originalFileName: "plan_a.dxf",
      storagePath: "storage/d-1.dxf",
      units: "mm",
      status: "processed",
      createdAt: "2026-10-29T10:00:00Z",
    });
    expect(result[1].status).toBe("failed");
  });

  it("handles empty array response correctly", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await listDrawings();
    expect(result).toEqual([]);
  });

  it("throws ApiAuthenticationError if no session exists", async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(listDrawings()).rejects.toBeInstanceOf(ApiAuthenticationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ApiHttpError when backend responds with an error code", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Database connection failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(listDrawings()).rejects.toMatchObject({
      name: "ApiHttpError",
      statusCode: 500,
      detail: "Database connection failed",
    });
  });

  it("normalizes drawing statuses including contract error and fallback", () => {
    expect(normalizeDrawingRecord({ status: "error" }).status).toBe("error");
    expect(normalizeDrawingRecord({ status: "failed" }).status).toBe("failed");
    expect(normalizeDrawingRecord({ status: "processing" }).status).toBe(
      "processing",
    );
    expect(normalizeDrawingRecord({ status: "processed" }).status).toBe(
      "processed",
    );
    expect(normalizeDrawingRecord({ status: "uploaded" }).status).toBe(
      "uploaded",
    );
    expect(normalizeDrawingRecord({ status: "pending" }).status).toBe(
      "pending",
    );
    expect(normalizeDrawingRecord({ status: "unknown_status" }).status).toBe(
      "uploaded",
    );
  });
});

describe("DrawingsList component states", () => {
  beforeEach(() => {
    queryState.value = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  it("renders accessible loading state matching design tokens", () => {
    queryState.value = {
      ...queryState.value,
      isLoading: true,
    };

    const html = renderToStaticMarkup(<DrawingsList />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Завантаження списку креслень…");
  });

  it("renders EmptyState when no drawings exist, with a link to /upload", () => {
    queryState.value = {
      ...queryState.value,
      data: [],
    };

    const html = renderToStaticMarkup(<DrawingsList />);
    expect(html).toContain("У вас ще немає креслень");
    expect(html).toContain('href="/upload"');
    expect(html).toContain("Завантажити креслення");
  });

  it("renders accessible error state with Ukrainian message and retry button", () => {
    const refetchMock = vi.fn();
    queryState.value = {
      ...queryState.value,
      isError: true,
      error: new ApiHttpError(500, "Internal error"),
      refetch: refetchMock,
    };

    const html = renderToStaticMarkup(<DrawingsList />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Не вдалося завантажити список креслень");
    expect(html).toContain("Спробувати знову");
  });

  it("renders populated drawings list with filenames, Ukrainian dates, status badges, and open links", () => {
    queryState.value = {
      ...queryState.value,
      data: mockDrawings,
    };

    const html = renderToStaticMarkup(<DrawingsList />);

    // Filenames
    expect(html).toContain("office_floor_1.dxf");
    expect(html).toContain("warehouse_plan.dxf");
    expect(html).toContain("hotel_complex.dxf");
    expect(html).toContain("parking_lot.dxf");
    expect(html).toContain("shopping_mall.dxf");
    expect(html).toContain("corrupted_archive.dxf");

    // Open links
    expect(html).toContain('href="/drawings/draw-1"');
    expect(html).toContain('href="/drawings/draw-2"');
    expect(html).toContain('href="/drawings/draw-3"');
    expect(html).toContain('href="/drawings/draw-4"');
    expect(html).toContain('href="/drawings/draw-5"');
    expect(html).toContain('href="/drawings/draw-6"');
    expect(html).toContain("Відкрити");

    // Ukrainian status badges
    expect(html).toContain("Оброблено");
    expect(html).toContain("В обробці");
    expect(html).toContain("Завантажено");
    expect(html).toContain("Помилка");
    expect(html).toContain("Очікує");

    // Privacy verification: ownerId and storagePath must NEVER be exposed in the UI
    expect(html).not.toContain("user-secret-123");
    expect(html).not.toContain("private/storage");

    // Semantic date tags
    expect(html).toContain('dateTime="2026-10-25T14:30:00.000Z"');
  });

  it("status badges render correct Ukrainian labels and icons for all statuses", () => {
    const processedHtml = renderToStaticMarkup(
      <DrawingStatusBadge status="processed" />,
    );
    expect(processedHtml).toContain("Оброблено");

    const processingHtml = renderToStaticMarkup(
      <DrawingStatusBadge status="processing" />,
    );
    expect(processingHtml).toContain("В обробці");
    expect(processingHtml).toContain("animate-spin");

    const uploadedHtml = renderToStaticMarkup(
      <DrawingStatusBadge status="uploaded" />,
    );
    expect(uploadedHtml).toContain("Завантажено");

    const failedHtml = renderToStaticMarkup(
      <DrawingStatusBadge status="failed" />,
    );
    expect(failedHtml).toContain("Помилка");

    const errorHtml = renderToStaticMarkup(
      <DrawingStatusBadge status="error" />,
    );
    expect(errorHtml).toContain("Помилка");

    const pendingHtml = renderToStaticMarkup(
      <DrawingStatusBadge status="pending" />,
    );
    expect(pendingHtml).toContain("Очікує");
  });

  it("formats date in Ukrainian locale", () => {
    const formatted = formatUkrainianDate("2026-10-29T13:45:00.000Z");
    // Should contain day, month, year, time numbers
    expect(formatted).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });
});

describe("DrawingsPage and AppHeader integration", () => {
  it("DrawingsPage renders heading and does not duplicate AppShell or PageContainer", () => {
    queryState.value = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(<DrawingsPage />);
    expect(html).toContain("Мої креслення");
    expect(html).toContain("Список завантажених DXF-креслень");
    // Ensure no nested <main> is created by the page itself
    expect(html).not.toContain("<main");
  });

  it("AppHeader includes visible navigation link to /drawings and preserves /upload", () => {
    const html = renderToStaticMarkup(<AppHeader />);
    expect(html).toContain('href="/drawings"');
    expect(html).toContain("Мої креслення");
    expect(html).toContain('href="/upload"');
    expect(html).toContain("Завантажити");
  });
});

const listDrawingsFixture: DrawingListItem[] = [
  {
    id: "draw-new",
    filename: "newest.dxf",
    createdAt: "2026-11-02T08:30:00.000Z",
    status: "pending",
  },
  {
    id: "draw-processing",
    filename: "processing.dxf",
    createdAt: "2026-11-01T09:00:00.000Z",
    status: "processing",
  },
  {
    id: "draw-done",
    filename: "done.dxf",
    createdAt: "2026-10-31T10:15:00.000Z",
    status: "done",
  },
  {
    id: "draw-error",
    filename: "broken.dxf",
    createdAt: "2026-10-30T11:45:00.000Z",
    status: "error",
  },
];

describe("DrawingsList rendering and interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.value = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("renders filenames and Ukrainian dates in the given order without re-sorting", () => {
    render(<DrawingsList drawings={listDrawingsFixture} />);

    const rows = screen.getAllByTestId("drawing-row");
    expect(rows).toHaveLength(listDrawingsFixture.length);

    listDrawingsFixture.forEach((drawing, index) => {
      const row = within(rows[index]);
      expect(row.getByText(drawing.filename)).toBeInTheDocument();
      expect(
        row.getByText(formatUkrainianDate(drawing.createdAt)),
      ).toBeInTheDocument();
    });
  });

  it("renders Ukrainian status badges and marks the error row with data-status=\"error\"", () => {
    render(<DrawingsList drawings={listDrawingsFixture} />);

    const rows = screen.getAllByTestId("drawing-row");
    const rowFor = (status: DrawingListItem["status"]) =>
      rows.find((row) => row.getAttribute("data-status") === status);

    expect(within(rowFor("pending")!).getByText("Очікує")).toBeInTheDocument();
    expect(
      within(rowFor("processing")!).getByText("Обробка"),
    ).toBeInTheDocument();
    expect(within(rowFor("done")!).getByText("Готово")).toBeInTheDocument();

    const errorRow = rowFor("error");
    expect(errorRow!).toHaveAttribute("data-status", "error");
    expect(
      within(errorRow!).getByText("Помилка обробки"),
    ).toBeInTheDocument();
  });

  it("calls onOpen with the drawing id when a row is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const [drawing] = listDrawingsFixture;

    render(<DrawingsList drawings={[drawing]} onOpen={onOpen} />);

    await user.click(screen.getByTestId("drawing-row"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(drawing.id);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("pushes /drawings/<id> when onOpen is omitted", async () => {
    const user = userEvent.setup();
    const drawing = listDrawingsFixture[1];

    render(<DrawingsList drawings={[drawing]} />);

    await user.click(screen.getByTestId("drawing-row"));

    expect(routerPush).toHaveBeenCalledWith(`/drawings/${drawing.id}`);
  });

  it("shows the empty state with a link to /upload", () => {
    render(<DrawingsList drawings={[]} />);

    expect(screen.getByText("У вас ще немає креслень")).toBeInTheDocument();

    const uploadLink = screen.getByRole("link", {
      name: /Завантажити (DXF|креслення)/,
    });
    expect(uploadLink).toHaveAttribute("href", "/upload");
  });
});
