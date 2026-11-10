/**
 * Official Whitelist & Normative Safety Rules for Ukrainian Standards
 * Task BIM-163 / BIM-124
 *
 * Enforces retrieval from verified Ukrainian official sources only.
 * Prohibits Russian domains (.ru, .su) and obsolete Soviet/Russian standards (СНиП, ГОСТ, etc.).
 */

/**
 * Official Ukrainian government portals and verified state registers.
 * Standards citations MUST originate from these domains to be marked as verified.
 */
export const OFFICIAL_UKRAINIAN_DOMAINS = [
  "zakon.rada.gov.ua",
  "dsns.gov.ua",
  "minregion.gov.ua",
  "budstandart.ua",
  "e-construction.gov.ua",
  "diam.gov.ua",
] as const;

export type OfficialUkrainianDomain = (typeof OFFICIAL_UKRAINIAN_DOMAINS)[number];

/**
 * Disallowed top-level domains and suffix patterns (e.g. Russian resources).
 */
export const DISALLOWED_DOMAIN_SUFFIXES = [
  ".ru",
  ".su",
  ".xn--p1ai", // Punycode for .рф
] as const;

/**
 * Obsolete Soviet and Russian normative identifiers strictly forbidden
 * from being cited as valid active standards in Ukraine.
 */
export const DISALLOWED_STANDARD_IDENTIFIERS = [
  "СНиП",
  "СНИП",
  "SNiP",
  "НПБ",
  "NPB",
  "ГОСТ",
  "GOST",
  "ВНПБ",
  "VNPB",
  "ВСН",
  "VSN",
] as const;

export type DisallowedStandardIdentifier = (typeof DISALLOWED_STANDARD_IDENTIFIERS)[number];

/**
 * Active Ukrainian fire safety standards whitelist verified under BIM-124.
 */
export interface ActiveStandardDefinition {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly officialSourceUrls: readonly string[];
}

export const ACTIVE_STANDARDS_WHITELIST: readonly ActiveStandardDefinition[] = [
  {
    code: "ДБН В.2.5-56:2014",
    title: "Системи протипожежного захисту",
    description:
      "Державні будівельні норми України щодо проєктування, монтування та експлуатації систем протипожежного захисту.",
    officialSourceUrls: [
      "https://zakon.rada.gov.ua",
      "https://minregion.gov.ua",
      "https://budstandart.ua",
    ],
  },
  {
    code: "ДСТУ EN 54",
    title: "Системи пожежної сигналізації (серія ДСТУ EN 54)",
    description:
      "Національні стандарти України, гармонізовані з європейськими нормами EN 54 для компонентів систем пожежної сигналізації.",
    officialSourceUrls: ["https://budstandart.ua"],
  },
  {
    code: "ДБН В.1.1-7:2016",
    title: "Пожежна безпека об'єктів будівництва",
    description:
      "Загальні вимоги пожежної безпеки під час проектування та будівництва об'єктів різного призначення.",
    officialSourceUrls: [
      "https://zakon.rada.gov.ua",
      "https://minregion.gov.ua",
      "https://budstandart.ua",
    ],
  },
] as const;

/**
 * Validates whether a given URL belongs to an approved official Ukrainian domain or subdomain.
 *
 * Rejects:
 * - Disallowed TLDs (.ru, .su, .рф)
 * - Spoofed domains (e.g. zakon.rada.gov.ua.attacker.com)
 * - Unverified third-party blogs or private websites
 * - Invalid or malformed URLs
 */
export function isOfficialDomain(url: string): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  let hostname: string;
  try {
    const urlToParse = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(urlToParse);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    hostname = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  if (!hostname || hostname.includes(" ")) {
    return false;
  }

  // Reject Russian / disallowed domain suffixes immediately
  for (const suffix of DISALLOWED_DOMAIN_SUFFIXES) {
    if (hostname === suffix.slice(1) || hostname.endsWith(suffix)) {
      return false;
    }
  }

  // Must match either exact official domain or a valid subdomain
  return OFFICIAL_UKRAINIAN_DOMAINS.some(
    (official) => hostname === official || hostname.endsWith(`.${official}`)
  );
}

/**
 * Validates whether a document code or name refers to an obsolete Soviet, Russian,
 * or disallowed normative standard.
 */
export function isDisallowedDocument(documentName: string): boolean {
  if (!documentName || typeof documentName !== "string") {
    return false;
  }

  const trimmed = documentName.trim();
  if (!trimmed) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes(".ru") || lower.includes(".su") || lower.includes(".рф")) {
    return true;
  }

  return DISALLOWED_STANDARD_IDENTIFIERS.some((ident) => {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${ident}([^\\p{L}\\p{N}]|$)`, "iu");
    return pattern.test(trimmed);
  });
}

/**
 * Checks whether a document name corresponds to one of the verified active Ukrainian standards.
 */
export function isActiveStandard(documentName: string): boolean {
  if (!documentName || typeof documentName !== "string") {
    return false;
  }

  if (isDisallowedDocument(documentName)) {
    return false;
  }

  const normalized = documentName
    .trim()
    .toUpperCase()
    .replace(/DBN/g, "ДБН")
    .replace(/DSTU/g, "ДСТУ")
    .replace(/V\./g, "В.");

  if (normalized.includes("ДБН В.2.5-56")) return true;
  if (normalized.includes("ДСТУ EN 54") || normalized.includes("ДСТУ-Н CEN/TS 54")) return true;
  if (normalized.includes("ДБН В.1.1-7")) return true;

  return false;
}

