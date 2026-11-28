// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingResult, Finding } from "@bim/contracts";
import type { Rule } from "@/lib/api/rules";
import {
  buildEngineeringReportData,
  buildReportFileName,
  generateReportHtml,
} from "@/lib/drawing/report";
import { EngineeringReport } from "@/components/drawing/engineering-report";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import { DrawingReportRoute } from "@/app/(protected)/drawings/[id]/report/drawing-report-route";
import DrawingReportPage from "@/app/(protected)/drawings/[id]/report/page";
import type { DrawingViewerProps } from "@/components/drawing/drawing-viewer";
import { fetchFindings } from "@/lib/drawing/findings";
import { fetchRules } from "@/lib/api/rules";
import { ApiHttpError } from "@/lib/api";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";

vi.mock("@/lib/drawing/findings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drawing/findings")>()),
  fetchFindings: vi.fn(),
}));
vi.mock("@/lib/api/rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rules")>()),
  fetchRules: vi.fn(),
}));
vi.mock("@/lib/drawing/plan-features-api", () => ({
  planFeaturesApi: {
    zones: async () => [],
    exits: async () => [],
  },
}));
vi.mock("@/components/drawing/drawing-viewer", () => ({
  DrawingViewer: (props: DrawingViewerProps) => (
    <div data-testid="viewer" data-source={props.url} />
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/rooms/room-types-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms/room-types-api")>()),
  useRoomTypes: () => ({ data: undefined }),
}));

const drawingId = "11111111-1111-4111-8111-111111111111";

const sampleResult: DrawingResult = {
  drawing: {
    id: drawingId,
    ownerId: "22222222-2222-4222-8222-222222222222",
    originalFileName: "office-floor-01.dxf",
    storagePath: "owner/office-floor-01.dxf",
    resolvedUnits: "mm",
    status: "processed",
    errorMessage: null,
    createdAt: "2026-11-28T10:00:00Z",
  },
  sourceDownloadUrl: "https://storage.example/source.dxf",
  sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z",
  downloadUrl: "https://storage.example/result.dxf",
  downloadUrlExpiresAt: "2099-01-01T00:00:00Z",
  rooms: [
    {
      id: "room-1",
      drawingId,
      name: "Кабінет 101",
      type: "office",
      height: 3.2,
      area: 48.5,
      polygon: [
        { x: 0, y: 0 },
        { x: 8000, y: 0 },
        { x: 8000, y: 6000 },
        { x: 0, y: 6000 },
      ],
      source: "fire_rooms",
      confirmed: true,
    },
    {
      id: "room-2",
      drawingId,
      name: "Серверна 102",
      type: "technical",
      height: null,
      area: 18,
      polygon: [
        { x: 8000, y: 0 },
        { x: 12000, y: 0 },
        { x: 12000, y: 4500 },
        { x: 8000, y: 4500 },
      ],
      source: "manual",
      confirmed: true,
    },
  ],
  devices: [
    {
      id: "dev-1",
      drawingId,
      roomId: "room-1",
      type: "smoke_detector",
      position: { x: 2000, y: 3000 },
      layer: "SYS_FIRE_SENSORS",
      ruleId: "rule-verified",
    },
    {
      id: "dev-2",
      drawingId,
      roomId: "room-1",
      type: "smoke_detector",
      position: { x: 6000, y: 3000 },
      layer: "SYS_FIRE_SENSORS",
      ruleId: "rule-verified",
    },
    {
      id: "dev-3",
      drawingId,
      roomId: "room-1",
      type: "sounder",
      position: { x: 4000, y: 1000 },
      layer: "SYS_FIRE_SENSORS",
      ruleId: "rule-unverified",
    },
    {
      id: "dev-4",
      drawingId,
      roomId: "room-2",
      type: "heat_detector",
      position: { x: 10000, y: 2000 },
      layer: "SYS_FIRE_SENSORS",
    },
    {
      id: "dev-5",
      drawingId,
      roomId: null,
      type: "manual_call_point",
      position: { x: 12500, y: 500 },
      layer: "SYS_FIRE_SENSORS",
    },
  ],
};

const sampleRules: Rule[] = [
  {
    id: "rule-verified",
    rule: "Крок димових сповіщувачів",
    value: "9 м",
    document: "ДБН В.2.5-56:2014",
    clause: "п. 7.2.1",
    status: "verified",
  },
  {
    id: "rule-unverified",
    rule: "Попередній крок оповіщувачів",
    value: "15 м",
    document: "ДБН В.2.5-56:2014",
    clause: "",
    status: "needs_verification",
  },
];

const sampleFindings: Finding[] = [
  {
    id: "finding-critical",
    drawingId,
    roomId: "room-1",
    deviceId: "dev-1",
    ruleId: "rule-verified",
    severity: "critical",
    message: "Перевищено максимальний крок між димовими сповіщувачами",
    document: "ДБН В.2.5-56:2014",
    clause: "п. 7.2.1",
    ruleStatus: "verified",
  },
  {
    id: "finding-review",
    drawingId,
    roomId: "room-1",
    deviceId: "dev-3",
    ruleId: "rule-unverified",
    severity: "warning",
    message: "Правило оповіщення не підтверджено інженером",
    document: "ДБН В.2.5-56:2014",
    clause: "п. 99.99-guessed",
    ruleStatus: "needs_review",
  },
  {
    id: "finding-info",
    drawingId,
    roomId: "room-2",
    deviceId: null,
    ruleId: null,
    severity: "insufficient_data",
    message: "Не вказано висоту приміщення для перевірки",
    document: null,
    clause: null,
    ruleStatus: null,
  },
  {
    id: "finding-conflict",
    drawingId,
    roomId: "room-1",
    deviceId: null,
    ruleId: "rule-verified",
    severity: "rule_conflict",
    message:
      "Конфлікт норм для Ручний сповіщувач: ДСТУ EN 54-14:2021 vs ДБН В.2.5-56:2014",
    document: "ДСТУ EN 54-14:2021",
    clause: "п. 6.6",
    ruleStatus: "verified",
    conflictDetails: {
      deviceType: "manual_call_point",
      valueKind: "max_grid_spacing_m",
      appliedRuleId: "r-dstu",
      rules: [
        {
          id: "r-dstu",
          ruleId: "MANUAL_CALL_POINT_DSTU",
          document: "ДСТУ EN 54-14:2021",
          clause: "п. 6.6",
          value: 30,
          verificationStatus: "verified",
        },
        {
          id: "r-dbn",
          ruleId: "MANUAL_CALL_POINT_DBN",
          document: "ДБН В.2.5-56:2014",
          clause: "п. 7.2.15",
          value: 50,
          verificationStatus: "verified",
        },
      ],
    },
  },
];

const clients: QueryClient[] = [];
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.mocked(fetchFindings).mockResolvedValue(sampleFindings);
  vi.mocked(fetchRules).mockResolvedValue(sampleRules);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildEngineeringReportData & generateReportHtml", () => {
  it("computes per-room device counts by type, unassigned devices, and totals (AC 4-6)", () => {
    const data = buildEngineeringReportData({
      drawing: sampleResult.drawing,
      rooms: sampleResult.rooms,
      devices: sampleResult.devices,
      findings: sampleFindings,
      rules: sampleRules,
      generatedAt: new Date("2026-11-28T12:00:00Z"),
    });

    expect(data.rooms).toHaveLength(2);
    expect(data.rooms[0]).toMatchObject({
      name: "Кабінет 101",
      typeLabel: "Офіс, кабінет",
      areaM2: 48.5,
      heightM: 3.2,
      deviceCounts: {
        smoke_detector: 2,
        heat_detector: 0,
        sounder: 1,
        manual_call_point: 0,
        total: 3,
      },
    });
    expect(data.rooms[1]).toMatchObject({
      name: "Серверна 102",
      typeLabel: "Технічне приміщення",
      areaM2: 18,
      heightM: null,
      deviceCounts: {
        smoke_detector: 0,
        heat_detector: 1,
        sounder: 0,
        manual_call_point: 0,
        total: 1,
      },
    });
    expect(data.unassignedDevices).toEqual({
      smoke_detector: 0,
      heat_detector: 0,
      sounder: 0,
      manual_call_point: 1,
      total: 1,
    });
    expect(data.totalDevices).toEqual({
      smoke_detector: 2,
      heat_detector: 1,
      sounder: 1,
      manual_call_point: 1,
      total: 5,
    });
  });

  it("never exposes unverified/fabricated clause numbers when needs_verification is set (AC 10-12)", () => {
    const data = buildEngineeringReportData({
      drawing: sampleResult.drawing,
      rooms: sampleResult.rooms,
      devices: sampleResult.devices,
      findings: sampleFindings,
      rules: sampleRules,
    });

    const reviewItem = data.findings.find((f) => f.id === "finding-review")!;
    expect(reviewItem.isNeedsVerification).toBe(true);
    expect(reviewItem.clause).toBeNull();

    const html = generateReportHtml(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain("@media print");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("Треба перевірити");
    expect(html).toContain("Пункт не підтверджено");
    expect(html).not.toContain("п. 99.99-guessed");
  });

  it("renders both conflicting documents, clauses, and engineer decision callout in standalone HTML (AC 13-15)", () => {
    const data = buildEngineeringReportData({
      drawing: sampleResult.drawing,
      rooms: sampleResult.rooms,
      devices: sampleResult.devices,
      findings: sampleFindings,
      rules: sampleRules,
    });

    const html = generateReportHtml(data);
    expect(html).toContain("Потрібне рішення інженера");
    expect(html).toContain("ДСТУ EN 54-14:2021");
    expect(html).toContain("п. 6.6");
    expect(html).toContain("ДБН В.2.5-56:2014");
    expect(html).toContain("п. 7.2.15");
    expect(buildReportFileName("dir/office-floor-01.dxf")).toBe(
      "dir_office-floor-01-report.html",
    );
  });

  it("escapes untrusted strings in generated HTML", () => {
    const data = buildEngineeringReportData({
      drawing: {
        ...sampleResult.drawing,
        originalFileName: '<script>alert("xss")</script>.dxf',
      },
      rooms: [],
      devices: [],
      findings: [],
    });

    const html = generateReportHtml(data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("EngineeringReport component", () => {
  it("renders rooms table, per-type counts, violations, needs_verification, and norm conflicts (AC 4-15)", () => {
    const data = buildEngineeringReportData({
      drawing: sampleResult.drawing,
      rooms: sampleResult.rooms,
      devices: sampleResult.devices,
      findings: sampleFindings,
      rules: sampleRules,
    });

    render(<EngineeringReport data={data} />);

    // Rooms table with name, type, area, height, and device counts per type
    const roomsSection = screen.getByRole("region", {
      name: "Приміщення та прилади",
    });
    const table = within(roomsSection).getByRole("table");
    expect(within(table).getByText("Кабінет 101")).toBeVisible();
    expect(within(table).getByText("Офіс, кабінет")).toBeVisible();
    expect(within(table).getByText(/48[,.]5 м²/)).toBeVisible();
    expect(within(table).getByText(/3[,.]2 м/)).toBeVisible();
    expect(within(table).getByText("Серверна 102")).toBeVisible();
    expect(within(table).getByText("Технічне приміщення")).toBeVisible();
    expect(within(table).getByText("Не вказано")).toBeVisible();
    expect(
      within(table).getByText("Поза приміщеннями (коридори / загальні зони)"),
    ).toBeVisible();

    // Violations list: room, description, severity, document, clause
    const findingsSection = screen.getByRole("region", {
      name: "Виявлені порушення",
    });
    expect(
      within(findingsSection).getByText(
        "Перевищено максимальний крок між димовими сповіщувачами",
      ),
    ).toBeVisible();
    expect(within(findingsSection).getByText("Критичний")).toBeVisible();
    expect(within(findingsSection).getByText("Попередження")).toBeVisible();
    expect(within(findingsSection).getByText("Інформаційний")).toBeVisible();
    expect(within(findingsSection).getAllByText("ДБН В.2.5-56:2014").length).toBeGreaterThan(0);
    expect(within(findingsSection).getByText("п. 7.2.1")).toBeVisible();

    // AC 10-12: needs_verification shows «Треба перевірити» and NO fabricated clause
    expect(within(findingsSection).getByText("Треба перевірити")).toBeVisible();
    expect(
      within(findingsSection).queryByText("п. 99.99-guessed"),
    ).not.toBeInTheDocument();

    // AC 13-15: norm conflict shows both documents with clauses and «Потрібне рішення інженера»
    const conflictSection = within(findingsSection).getByRole("region", {
      name: "Конфлікт нормативних вимог",
    });
    expect(
      within(conflictSection).getByText("Потрібне рішення інженера"),
    ).toBeVisible();
    expect(
      within(conflictSection).getByText("ДСТУ EN 54-14:2021"),
    ).toBeVisible();
    expect(within(conflictSection).getByText("п. 6.6")).toBeVisible();
    expect(
      within(conflictSection).getByText("ДБН В.2.5-56:2014"),
    ).toBeVisible();
    expect(within(conflictSection).getByText("п. 7.2.15")).toBeVisible();
  });
});

describe("Download alongside DXF & printable report routes (AC 1-3, AC 6)", () => {
  it("downloads both result DXF and self-contained HTML report when clicking «Завантажити звіт»", async () => {
    const downloads: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });

    const createdBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return `blob:test-${createdBlobs.length}`;
    });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("DXF RESULT CONTENT")),
    );

    const api = {
      getDrawing: vi.fn(async () => sampleResult),
      processDrawing: vi.fn(async () => sampleResult),
    };

    render(<DrawingDetail id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    const reportBtn = await screen.findByRole("button", {
      name: "Завантажити звіт",
    });
    expect(reportBtn).toBeEnabled();

    const reportLink = screen.getByRole("link", { name: "Відкрити звіт" });
    expect(reportLink).toHaveAttribute("href", `/drawings/${drawingId}/report`);

    // Wait for findings to settle before clicking download
    await waitFor(() => expect(fetchFindings).toHaveBeenCalled());

    fireEvent.click(reportBtn);

    await screen.findByText(
      "Звіт та DXF результату передано браузеру для збереження.",
    );

    expect(downloads.map((d) => d.download)).toEqual([
      "office-floor-01-processed.dxf",
      "office-floor-01-report.html",
    ]);
    expect(createdBlobs).toHaveLength(2);
    const htmlContent = await createdBlobs[1].text();
    expect(htmlContent).toContain("Кабінет 101");
    expect(htmlContent).toContain("Треба перевірити");
    expect(htmlContent).toContain("Потрібне рішення інженера");
    expect(htmlContent).not.toContain("п. 99.99-guessed");
  });

  it("disables «Завантажити звіт» until processing & placement complete", async () => {
    const pendingResult: DrawingResult = {
      ...sampleResult,
      drawing: { ...sampleResult.drawing, status: "processing" },
      devices: [],
      downloadUrl: null,
      downloadUrlExpiresAt: null,
    };

    render(
      <DrawingDetail
        id={drawingId}
        api={{
          getDrawing: async () => pendingResult,
          processDrawing: async () => pendingResult,
        }}
      />,
      { wrapper: createWrapper() },
    );

    const reportBtn = await screen.findByRole("button", {
      name: "Завантажити звіт",
    });
    expect(reportBtn).toBeDisabled();
  });

  it("renders interactive Report tab inside DrawingDetail with print & HTML download controls", async () => {
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    render(
      <DrawingDetail
        id={drawingId}
        api={{
          getDrawing: async () => sampleResult,
          processDrawing: async () => sampleResult,
        }}
      />,
      { wrapper: createWrapper() },
    );

    const reportTab = await screen.findByRole("tab", { name: "Звіт" });
    fireEvent.click(reportTab);

    const printBtn = await screen.findByRole("button", {
      name: "Друк / Зберегти як PDF",
    });
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalledOnce();

    expect(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    ).toBeEnabled();
    expect((await screen.findAllByText("Кабінет 101")).length).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText("Потрібне рішення інженера")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("п. 99.99-guessed")).not.toBeInTheDocument();
  });

  it("resolves /drawings/[id]/report page params and renders DrawingReportRoute", async () => {
    const element = await DrawingReportPage({
      params: Promise.resolve({ id: drawingId }),
    });
    expect(element.props.id).toBe(drawingId);
    expect(element.key).toBe(drawingId);

    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    render(
      <DrawingReportRoute
        id={drawingId}
        api={{
          getDrawing: async () => sampleResult,
          processDrawing: async () => sampleResult,
        }}
      />,
      { wrapper: createWrapper() },
    );

    await screen.findByRole("article", { name: "Інженерний звіт" });
    expect(screen.getByRole("link", { name: /Повернутися до креслення/ })).toHaveAttribute(
      "href",
      `/drawings/${drawingId}`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Друк / Зберегти як PDF" }),
    );
    expect(printSpy).toHaveBeenCalledOnce();
    expect((await screen.findAllByText("ДСТУ EN 54-14:2021")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Кабінет 101").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ДБН В.2.5-56:2014").length).toBeGreaterThan(0);
    expect(screen.getByText("Треба перевірити")).toBeVisible();
    expect(screen.getAllByText("Потрібне рішення інженера").length).toBeGreaterThan(0);
  });
});

describe("BIM-79 blocker: unavailable or pending audit never reports zero violations", () => {
  it("marks unavailable and pending report models as incomplete without zero-violations text", () => {
    const unavailable = buildEngineeringReportData({
      drawing: sampleResult.drawing,
      rooms: sampleResult.rooms,
      devices: sampleResult.devices,
      findings: [],
      auditStatus: "unavailable",
      auditError: "Сервер не зміг виконати запит.",
    });
    const unavailableHtml = generateReportHtml(unavailable);
    expect(unavailableHtml).toContain("Неповний звіт: результати аудиту недоступні");
    expect(unavailableHtml).toContain("Аудит нормативних вимог недоступний — перевірку не виконано");
    expect(unavailableHtml).toContain("Сервер не зміг виконати запит.");
    expect(unavailableHtml).not.toMatch(/Порушень[\s\S]*не виявлено/i);

    const pending = buildEngineeringReportData({
      drawing: sampleResult.drawing,
      rooms: sampleResult.rooms,
      devices: sampleResult.devices,
      findings: [],
      auditStatus: "pending",
    });
    const pendingHtml = generateReportHtml(pending);
    expect(pendingHtml).toContain("Очікується завершення аудиту");
    expect(pendingHtml).not.toMatch(/Порушень[\s\S]*не виявлено/i);
  });

  function setupDownloadCapture() {
    const downloads: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });
    const createdBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return `blob:bim79-${createdBlobs.length}`;
    });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("DXF RESULT CONTENT")),
    );
    return { downloads, createdBlobs };
  }

  it("quick export «Завантажити звіт» warns on HTTP 503 findings and only claims clean audit on 200 []", async () => {
    const { downloads, createdBlobs } = setupDownloadCapture();
    vi.mocked(fetchFindings).mockRejectedValue(new ApiHttpError(503));

    const api = {
      getDrawing: vi.fn(async () => sampleResult),
      processDrawing: vi.fn(async () => sampleResult),
    };

    const view = render(<DrawingDetail id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    const quickExportBtn = await screen.findByRole("button", {
      name: "Завантажити звіт",
    });
    await waitFor(() => expect(fetchFindings).toHaveBeenCalledTimes(1));

    fireEvent.click(quickExportBtn);
    await screen.findByText(
      "Звіт та DXF результату передано браузеру для збереження.",
    );

    expect(downloads.map((d) => d.download)).toEqual([
      "office-floor-01-processed.dxf",
      "office-floor-01-report.html",
    ]);
    const html503 = await createdBlobs[1].text();
    expect(html503).toContain("Неповний звіт: результати аудиту недоступні");
    expect(html503).toContain("Аудит нормативних вимог недоступний — перевірку не виконано");
    expect(html503).not.toMatch(/Порушень[\s\S]*не виявлено/i);

    view.unmount();
    cleanup();
    downloads.length = 0;
    createdBlobs.length = 0;

    vi.mocked(fetchFindings).mockResolvedValue([]);
    render(<DrawingDetail id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    const quickExportBtn200 = await screen.findByRole("button", {
      name: "Завантажити звіт",
    });
    await waitFor(() => expect(fetchFindings).toHaveBeenCalledTimes(2));

    fireEvent.click(quickExportBtn200);
    await screen.findByText(
      "Звіт та DXF результату передано браузеру для збереження.",
    );

    const html200 = await createdBlobs[1].text();
    expect(html200).toContain("Порушень відповідності нормативним вимогам не виявлено.");
    expect(html200).not.toContain("Неповний звіт");
    expect(html200).not.toContain("Аудит нормативних вимог недоступний");
  });

  it("Report tab «Завантажити HTML-звіт» & printable DOM warn on HTTP 503 vs 200 []", async () => {
    const { createdBlobs } = setupDownloadCapture();
    vi.mocked(fetchFindings).mockRejectedValue(new ApiHttpError(503));

    const api = {
      getDrawing: vi.fn(async () => sampleResult),
      processDrawing: vi.fn(async () => sampleResult),
    };

    const view = render(<DrawingDetail id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Звіт" }));

    const warningHeading = await screen.findByText(
      "Неповний звіт: результати аудиту недоступні",
    );
    expect(warningHeading).toBeVisible();
    expect(warningHeading.closest("[data-print-hide]")).toBeNull();
    expect(
      screen.queryByText(/Порушень.*не виявлено/i),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    );
    const html503 = await createdBlobs[0].text();
    expect(html503).toContain("Неповний звіт: результати аудиту недоступні");
    expect(html503).not.toMatch(/Порушень[\s\S]*не виявлено/i);

    view.unmount();
    cleanup();
    createdBlobs.length = 0;

    vi.mocked(fetchFindings).mockResolvedValue([]);
    render(<DrawingDetail id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Звіт" }));
    expect(
      await screen.findByText(
        "Порушень відповідності нормативним вимогам не виявлено.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Неповний звіт/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    );
    const html200 = await createdBlobs[0].text();
    expect(html200).toContain("Порушень відповідності нормативним вимогам не виявлено.");
    expect(html200).not.toContain("Неповний звіт");
  });

  it("Dedicated /drawings/[id]/report route warns in print DOM and HTML export on HTTP 503 vs 200 []", async () => {
    const { createdBlobs } = setupDownloadCapture();
    vi.mocked(fetchFindings).mockRejectedValue(new ApiHttpError(503));

    const api = {
      getDrawing: vi.fn(async () => sampleResult),
      processDrawing: vi.fn(async () => sampleResult),
    };

    const view = render(<DrawingReportRoute id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    const warningHeading = await screen.findByText(
      "Неповний звіт: результати аудиту недоступні",
    );
    expect(warningHeading).toBeVisible();
    expect(warningHeading.closest("[data-print-hide]")).toBeNull();
    expect(
      screen.queryByText(/Порушень.*не виявлено/i),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    );
    const html503 = await createdBlobs[0].text();
    expect(html503).toContain("Неповний звіт: результати аудиту недоступні");
    expect(html503).toContain("Аудит нормативних вимог недоступний — перевірку не виконано");
    expect(html503).not.toMatch(/Порушень[\s\S]*не виявлено/i);

    view.unmount();
    cleanup();
    createdBlobs.length = 0;

    vi.mocked(fetchFindings).mockResolvedValue([]);
    render(<DrawingReportRoute id={drawingId} api={api} />, {
      wrapper: createWrapper(),
    });

    expect(
      await screen.findByText(
        "Порушень відповідності нормативним вимогам не виявлено.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Неповний звіт/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    );
    const html200 = await createdBlobs[0].text();
    expect(html200).toContain("Порушень відповідності нормативним вимогам не виявлено.");
    expect(html200).not.toContain("Неповний звіт");
    expect(html200).not.toContain("Демонстраційний звіт: аудит не проводився");
  });

  it("Demo processed drawing marks report as «Демонстраційний звіт: аудит не проводився» across exports and print DOM", async () => {
    const { createdBlobs } = setupDownloadCapture();
    const demoResultWithUrl: DrawingResult = {
      ...DEMO_RESULT,
      sourceDownloadUrl: "https://storage.example/demo-source.dxf",
      sourceDownloadUrlExpiresAt: "2099-01-01T00:00:00Z",
      downloadUrl: "https://storage.example/demo-result.dxf",
      downloadUrlExpiresAt: "2099-01-01T00:00:00Z",
    };
    const demoApi = {
      getDrawing: vi.fn(async () => demoResultWithUrl),
      processDrawing: vi.fn(async () => demoResultWithUrl),
    };

    const detailView = render(
      <DrawingDetail id={DEMO_RESULT.drawing.id} api={demoApi} demo />,
      { wrapper: createWrapper() },
    );

    // 1. Quick export «Завантажити звіт» on processed demo drawing
    const quickExportBtn = await screen.findByRole("button", {
      name: "Завантажити звіт",
    });
    fireEvent.click(quickExportBtn);
    await screen.findByText(
      "Звіт та DXF результату передано браузеру для збереження.",
    );
    const quickHtml = await createdBlobs[1].text();
    expect(quickHtml).toContain("Демонстраційний звіт: аудит не проводився");
    expect(quickHtml).not.toMatch(/Порушень[\s\S]*не виявлено/i);

    // 2. Report tab printable DOM and «Завантажити HTML-звіт»
    createdBlobs.length = 0;
    fireEvent.click(screen.getByRole("tab", { name: "Звіт" }));
    const tabDemoLabels = await screen.findAllByText(
      /Демонстраційний звіт: аудит не проводився/,
    );
    expect(tabDemoLabels.length).toBeGreaterThan(0);
    for (const node of tabDemoLabels) {
      expect(node.closest("[data-print-hide]")).toBeNull();
    }
    expect(
      screen.queryByText(/Порушень.*не виявлено/i),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    );
    const tabHtml = await createdBlobs[0].text();
    expect(tabHtml).toContain("Демонстраційний звіт: аудит не проводився");
    expect(tabHtml).not.toMatch(/Порушень[\s\S]*не виявлено/i);

    detailView.unmount();
    cleanup();
    createdBlobs.length = 0;

    // 3. Dedicated /drawings/[id]/report route with demo drawing
    render(
      <DrawingReportRoute id={DEMO_RESULT.drawing.id} api={demoApi} demo />,
      { wrapper: createWrapper() },
    );
    const routeDemoLabels = await screen.findAllByText(
      /Демонстраційний звіт: аудит не проводився/,
    );
    expect(routeDemoLabels.length).toBeGreaterThan(0);
    for (const node of routeDemoLabels) {
      expect(node.closest("[data-print-hide]")).toBeNull();
    }
    expect(
      screen.queryByText(/Порушень.*не виявлено/i),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Завантажити HTML-звіт" }),
    );
    const routeHtml = await createdBlobs[0].text();
    expect(routeHtml).toContain("Демонстраційний звіт: аудит не проводився");
    expect(routeHtml).not.toMatch(/Порушень[\s\S]*не виявлено/i);
    expect(fetchFindings).not.toHaveBeenCalled();
  });
});
