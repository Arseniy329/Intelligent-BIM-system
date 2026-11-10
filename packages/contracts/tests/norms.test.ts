import { describe, expect, it } from "vitest";
import {
  ACTIVE_STANDARDS_WHITELIST,
  DISALLOWED_DOMAIN_SUFFIXES,
  DISALLOWED_STANDARD_IDENTIFIERS,
  OFFICIAL_UKRAINIAN_DOMAINS,
  canSafelyBeNullWhenUnverified,
  createNeedsVerificationResult,
  createVerifiedNormResult,
  isActiveStandard,
  isDisallowedDocument,
  isNormLookupRequest,
  isNormLookupResult,
  isOfficialDomain,
  safeParseNormLookupRequest,
  safeParseNormLookupResult,
  validateNormLookupRequest,
  validateNormLookupResult,
  type NormLookupRequest,
  type NormLookupResult,
} from "../src/index.js";

describe("Official Ukrainian Domains Whitelist (BIM-124 / BIM-163)", () => {
  it("contains all required Ukrainian state portals and registers", () => {
    expect(OFFICIAL_UKRAINIAN_DOMAINS).toContain("zakon.rada.gov.ua");
    expect(OFFICIAL_UKRAINIAN_DOMAINS).toContain("dsns.gov.ua");
    expect(OFFICIAL_UKRAINIAN_DOMAINS).toContain("minregion.gov.ua");
    expect(OFFICIAL_UKRAINIAN_DOMAINS).toContain("budstandart.ua");
    expect(OFFICIAL_UKRAINIAN_DOMAINS).toContain("e-construction.gov.ua");
    expect(OFFICIAL_UKRAINIAN_DOMAINS).toContain("diam.gov.ua");
  });

  it.each([
    ["https://zakon.rada.gov.ua/laws/show/z1128-14"],
    ["http://zakon.rada.gov.ua/laws/show/2114-12"],
    ["https://dsns.gov.ua/uk/normativna-baza"],
    ["https://kiev.dsns.gov.ua/info/rules"],
    ["https://minregion.gov.ua/regulations/building-standards"],
    ["https://budstandart.ua/dbn-v-2-5-56-2014"],
    ["https://online.budstandart.ua/ua/catalog/doc-page.html?id_doc=58087"],
    ["https://e-construction.gov.ua/registry"],
    ["https://diam.gov.ua/documents"],
    ["zakon.rada.gov.ua/laws"],
    ["dsns.gov.ua"],
    ["budstandart.ua"],
  ])("accepts official Ukrainian domain: %s", (url) => {
    expect(isOfficialDomain(url)).toBe(true);
  });

  it.each([
    // Russian domains (.ru, .su, punycode .рф)
    ["https://mchs.gov.ru/activities/fire-safety"],
    ["http://docs.cntd.ru/document/1200000000"],
    ["https://norma-cs.ru/standards"],
    ["https://stroyplan.su/docs"],
    ["http://пожарная-безопасность.xn--p1ai"],
    ["https://zakon.rada.gov.ua.evil.ru"],
    ["https://dsns.gov.ru"],

    // Unverified third-party blogs and forums
    ["https://engineering-blog.com/ua-fire-norms"],
    ["https://medium.com/@author/fire-safety-standards"],
    ["https://t.me/fire_safety_ua"],
    ["https://forum.stroimdom.com.ua/topic/12345"],

    // Attacker spoofing attempts
    ["https://zakon.rada.gov.ua.attacker-server.com"],
    ["https://fakebudstandart.ua"],
    ["https://budstandart.ua.fake.com"],
    ["https://evil-dsns.gov.ua"],

    // Invalid/malicious protocols and payloads
    ["javascript:alert(1)"],
    ["data:text/html,<script>evil()</script>"],
    ["ftp://zakon.rada.gov.ua/file.pdf"],
    [""],
    ["   "],
    ["not-a-valid-url"],
  ])("rejects non-official or disallowed domain: %s", (url) => {
    expect(isOfficialDomain(url)).toBe(false);
  });
});

describe("Obsolete Soviet & Russian Norms Rejection (BIM-124 / BIM-163)", () => {
  it("defines all forbidden Soviet/Russian normative acronyms", () => {
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("СНиП");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("СНИП");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("SNiP");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("НПБ");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("NPB");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("ГОСТ");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("GOST");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("ВНПБ");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("VNPB");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("ВСН");
    expect(DISALLOWED_STANDARD_IDENTIFIERS).toContain("VSN");
  });

  it.each([
    ["СНиП 2.04.09-84 Пожарная автоматика зданий и сооружений"],
    ["СНИП 21-01-97* Пожарная безопасность зданий"],
    ["SNiP 2.04.09-84"],
    ["НПБ 88-2001 Установки пожаротушения и сигнализации"],
    ["NPB 88-2001"],
    ["ГОСТ 12.1.004-91 Пожарная безопасность"],
    ["ГОСТ 27990-88"],
    ["GOST 12.1.004-91"],
    ["ВНПБ-01-08"],
    ["VNPB-01-08"],
    ["ВСН 25-09.67-85"],
    ["VSN 25-09.67-85"],
    ["Норматив із сайту docs.cntd.ru"],
    ["Документ stroyplan.su"],
  ])("flags disallowed obsolete standard: %s", (docName) => {
    expect(isDisallowedDocument(docName)).toBe(true);
  });

  it.each([
    ["ДБН В.2.5-56:2014 Системи протипожежного захисту"],
    ["ДБН В.2.5-56:2014"],
    ["ДСТУ EN 54-1:2003 Системи пожежної сигналізації"],
    ["ДСТУ EN 54-2"],
    ["ДСТУ EN 54-5:2003"],
    ["ДСТУ-Н CEN/TS 54-14:2009"],
    ["ДБН В.1.1-7:2016 Пожежна безпека об'єктів будівництва"],
    ["ДБН В.1.1-7:2016"],
  ])("permits valid Ukrainian standard: %s", (docName) => {
    expect(isDisallowedDocument(docName)).toBe(false);
  });
});

describe("Active Ukrainian Standards Whitelist (BIM-124)", () => {
  it("includes primary fire safety standards", () => {
    const codes = ACTIVE_STANDARDS_WHITELIST.map((s) => s.code);
    expect(codes).toContain("ДБН В.2.5-56:2014");
    expect(codes).toContain("ДСТУ EN 54");
    expect(codes).toContain("ДБН В.1.1-7:2016");
  });

  it.each([
    ["ДБН В.2.5-56:2014", true],
    ["ДБН В.2.5-56:2014 Системи протипожежного захисту", true],
    ["ДСТУ EN 54-1:2003", true],
    ["ДСТУ EN 54-2", true],
    ["ДСТУ-Н CEN/TS 54-14:2009", true],
    ["ДБН В.1.1-7:2016", true],
    ["СНиП 2.04.09-84", false],
    ["ГОСТ 12.1.004-91", false],
    ["Невідомий документ 123", false],
  ])("isActiveStandard correctly evaluates %s -> %s", (docName, expected) => {
    expect(isActiveStandard(docName)).toBe(expected);
  });
});

describe("NormLookupRequest Contract & Schema", () => {
  it("validates and serializes a complete request", () => {
    const request: NormLookupRequest = {
      query: "яку площу контролює точковий димовий сповіщувач при висоті 3.5 м",
      context: {
        roomHeight: 3.5,
        roomArea: 75.0,
        detectorType: "smoke_detector",
        roomType: "office",
        buildingType: "public",
      },
    };

    const validated = validateNormLookupRequest(request);
    expect(validated.query).toBe(request.query);
    expect(validated.context?.roomHeight).toBe(3.5);

    // Serialization & deserialization round-trip
    const json = JSON.stringify(validated);
    const parsed = JSON.parse(json);
    expect(validateNormLookupRequest(parsed)).toEqual(validated);
    expect(isNormLookupRequest(parsed)).toBe(true);
  });

  it("validates request without context", () => {
    const request: NormLookupRequest = {
      query: "відстань між сповіщувачами",
    };

    const validated = validateNormLookupRequest(request);
    expect(validated.query).toBe("відстань між сповіщувачами");
    expect(validated.context).toBeUndefined();
  });

  it("rejects empty query", () => {
    expect(() => validateNormLookupRequest({ query: "" })).toThrow();
    expect(() => validateNormLookupRequest({ query: "   " })).toThrow();
    expect(safeParseNormLookupRequest({ query: "" }).success).toBe(false);
    expect(isNormLookupRequest({ query: "" })).toBe(false);
  });
});

describe("NormLookupResult Contract & Strict Safety Enforcements", () => {
  it("validates and serializes a fully verified norm result", () => {
    const verified: NormLookupResult = {
      document: "ДБН В.2.5-56:2014",
      clause: "Таблиця А.1, пункт 6.2.23",
      value: "до 85 м²",
      sourceUrl: "https://zakon.rada.gov.ua/laws/show/z1128-14",
      checkedAt: "2026-11-07T10:00:00.000Z",
      status: "found_in_official_source",
      summary: "При висоті до 3.5 м один точковий димовий сповіщувач контролює площу до 85 м².",
      rawSnippet: "Таблиця А.1 — Середня площа, що контролюється одним точковим сповіщувачем: 85 м².",
    };

    const validated = validateNormLookupResult(verified);
    expect(validated.document).toBe("ДБН В.2.5-56:2014");
    expect(validated.status).toBe("found_in_official_source");

    // Serialization round-trip
    const json = JSON.stringify(validated);
    const parsed = JSON.parse(json);
    expect(validateNormLookupResult(parsed)).toEqual(validated);
    expect(isNormLookupResult(parsed)).toBe(true);
  });

  it("creates verified result via factory helper", () => {
    const result = createVerifiedNormResult({
      document: "ДБН В.2.5-56:2014",
      clause: "Таблиця А.1",
      value: 85,
      sourceUrl: "https://budstandart.ua/doc/dbn-v-2-5-56-2014",
      summary: "Максимальна площа захисту 85 м2",
      rawSnippet: "Таблиця А.1...",
    });

    expect(result.status).toBe("found_in_official_source");
    expect(result.document).toBe("ДБН В.2.5-56:2014");
    expect(result.value).toBe(85);
  });

  it("REJECTS verified result if document is missing or null", () => {
    const invalid = {
      document: null,
      clause: "Таблиця А.1",
      value: "85 м²",
      sourceUrl: "https://zakon.rada.gov.ua/laws/show/z1128-14",
      checkedAt: "2026-11-07T10:00:00.000Z",
      status: "found_in_official_source",
      summary: "Перевірено",
    };

    expect(() => validateNormLookupResult(invalid)).toThrow(
      /Verified norm result must specify an official document name/
    );
  });

  it("REJECTS verified result if clause is missing or null (NO HALLUCINATIONS)", () => {
    const invalid = {
      document: "ДБН В.2.5-56:2014",
      clause: null,
      value: "85 м²",
      sourceUrl: "https://zakon.rada.gov.ua/laws/show/z1128-14",
      checkedAt: "2026-11-07T10:00:00.000Z",
      status: "found_in_official_source",
      summary: "Перевірено",
    };

    expect(() => validateNormLookupResult(invalid)).toThrow(
      /Verified norm result must specify a concrete clause or table/
    );
  });

  it("REJECTS verified result if sourceUrl is not from an approved official Ukrainian domain", () => {
    const invalidWithRu = {
      document: "ДБН В.2.5-56:2014",
      clause: "Таблиця А.1",
      value: "85 м²",
      sourceUrl: "https://mchs.gov.ru/norms",
      checkedAt: "2026-11-07T10:00:00.000Z",
      status: "found_in_official_source",
      summary: "Тест",
    };

    expect(() => validateNormLookupResult(invalidWithRu)).toThrow(
      /not on the official Ukrainian whitelist/
    );

    const invalidWithBlog = {
      ...invalidWithRu,
      sourceUrl: "https://unverified-blog.com/dbn-article",
    };

    expect(() => validateNormLookupResult(invalidWithBlog)).toThrow(
      /not on the official Ukrainian whitelist/
    );
  });

  it("REJECTS verified result citing an obsolete Soviet or Russian standard", () => {
    const invalidSnip = {
      document: "СНиП 2.04.09-84",
      clause: "Таблиця 1",
      value: "85 м²",
      sourceUrl: "https://zakon.rada.gov.ua/laws/show/z1128-14",
      checkedAt: "2026-11-07T10:00:00.000Z",
      status: "found_in_official_source",
      summary: "Заборонений радянський норматив",
    };

    expect(() => validateNormLookupResult(invalidSnip)).toThrow(
      /obsolete or disallowed standard/
    );
  });

  it("allows clause and document to safely be NULL when status is 'needs_verification'", () => {
    const unverified: NormLookupResult = {
      document: null,
      clause: null,
      value: null,
      sourceUrl: null,
      checkedAt: "2026-11-07T10:00:00.000Z",
      status: "needs_verification",
      summary: "Вимогу не знайдено в чинних реєстрах ДБН В.2.5-56:2014; потрібна ручна верифікація інженером.",
      rawSnippet: null,
    };

    const validated = validateNormLookupResult(unverified);
    expect(validated.document).toBeNull();
    expect(validated.clause).toBeNull();
    expect(validated.status).toBe("needs_verification");
    expect(canSafelyBeNullWhenUnverified(validated)).toBe(true);

    // Serialization round-trip
    const json = JSON.stringify(validated);
    const parsed = JSON.parse(json);
    expect(validateNormLookupResult(parsed)).toEqual(validated);
  });

  it("enforces default NULLs via createNeedsVerificationResult to avoid hallucinated strings", () => {
    const result = createNeedsVerificationResult({
      summary: "Необхідно перевірити креслення щодо висоти стелі.",
    });

    expect(result.status).toBe("needs_verification");
    expect(result.document).toBeNull();
    expect(result.clause).toBeNull();
    expect(result.value).toBeNull();
    expect(result.sourceUrl).toBeNull();
    expect(result.rawSnippet).toBeNull();
    expect(typeof result.checkedAt).toBe("string");
    expect(canSafelyBeNullWhenUnverified(result)).toBe(true);
  });

  it("REJECTS needs_verification result if tentative document is an obsolete Soviet norm", () => {
    expect(() =>
      createNeedsVerificationResult({
        summary: "Спроба посилатися на СНиП",
        document: "СНиП 2.04.09-84",
      })
    ).toThrow(/obsolete or disallowed standard/);
  });
});

