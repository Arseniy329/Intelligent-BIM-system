// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NormLookupResult } from "@bim/contracts";
import { NormsLookupForm } from "@/components/rules/norms-lookup-form";

const lookupNormMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/rules", () => ({
  lookupNorm: lookupNormMock,
}));

const verifiedSourceUrl =
  "https://dsns.gov.ua/uk/normativna-baza/dbn-v-2-5-56-2014";

const verifiedFixture: NormLookupResult = {
  document: "ДБН В.2.5-56:2014",
  clause: "Таблиця А.1, пункт 6.2.23",
  value: "до 85 м²",
  sourceUrl: verifiedSourceUrl,
  checkedAt: "2026-11-12T09:00:00.000Z",
  status: "found_in_official_source",
  summary: "При висоті до 3.5 м димовий сповіщувач контролює площу до 85 м².",
  rawSnippet: "Таблиця А.1: 85 м².",
};

const needsVerificationFixture: NormLookupResult = {
  document: null,
  clause: null,
  value: null,
  sourceUrl: null,
  checkedAt: "2026-11-12T09:00:00.000Z",
  status: "needs_verification",
  summary: "Вимогу не знайдено; потрібна ручна перевірка інженером.",
  rawSnippet: null,
};

const zeroValueFixture: NormLookupResult = {
  document: "ДБН В.1.1-7:2016",
  clause: "Пункт 6.2.22",
  value: 0,
  sourceUrl: "https://zakon.rada.gov.ua/laws/show/z1128-14",
  checkedAt: "2026-11-12T09:00:00.000Z",
  status: "found_in_official_source",
  summary: "Граничне значення дорівнює 0.",
  rawSnippet: null,
};

async function submitQuery(query: string) {
  fireEvent.change(screen.getByLabelText("Запит до агента норм"), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: "Знайти" }));
}

describe("NormsLookupForm", () => {
  beforeEach(() => {
    lookupNormMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders verified result with source link, summary and readable status", async () => {
    lookupNormMock.mockResolvedValue(verifiedFixture);
    render(<NormsLookupForm />);

    await submitQuery("площа димового сповіщувача");

    expect(
      await screen.findByText("Знайдено в офіційному джерелі"),
    ).toBeInTheDocument();
    expect(screen.getByText(verifiedFixture.summary)).toBeInTheDocument();
    expect(screen.getByText("ДБН В.2.5-56:2014")).toBeInTheDocument();
    expect(screen.getByText("Таблиця А.1, пункт 6.2.23")).toBeInTheDocument();

    const sourceLink = screen.getByRole("link", { name: verifiedSourceUrl });
    expect(sourceLink).toHaveAttribute("href", verifiedSourceUrl);
    expect(sourceLink).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("found_in_official_source")).not.toBeInTheDocument();
  });

  it("renders needs_verification with nullable fields and readable status", async () => {
    lookupNormMock.mockResolvedValue(needsVerificationFixture);
    render(<NormsLookupForm />);

    await submitQuery("відстань між сповіщувачами");

    expect(await screen.findByText("Треба перевірити")).toBeInTheDocument();
    expect(screen.getByText(needsVerificationFixture.summary)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("needs_verification")).not.toBeInTheDocument();
  });

  it("renders numeric zero value instead of hiding it", async () => {
    lookupNormMock.mockResolvedValue(zeroValueFixture);
    render(<NormsLookupForm />);

    await submitQuery("граничне значення");

    expect(await screen.findByText("Значення")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(zeroValueFixture.summary)).toBeInTheDocument();
  });
});
