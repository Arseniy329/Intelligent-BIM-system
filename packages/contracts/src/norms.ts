/**
 * Norms Search Agent Contracts & Schemas
 * Task BIM-163: "Norms Search Agent Prototype — Valid Ukrainian Standards from Official Sources Only"
 *
 * Defines shared contracts between the frontend (BIM-165) and backend agent lookup service.
 * Enforces retrieval from verified Ukrainian official sources only.
 * Prohibits hallucinated clauses: missing or unverified clauses strictly default to null.
 */

import { z } from "zod";
import { isDisallowedDocument, isOfficialDomain } from "./norms-whitelist.js";

/**
 * Status indicating whether a norm was verified directly against an official source
 * or requires engineer verification.
 */
export type NormVerificationStatus = "found_in_official_source" | "needs_verification";

export const NormVerificationStatusSchema = z.enum([
  "found_in_official_source",
  "needs_verification",
]);

/**
 * Strongly typed context parameters for norms search.
 * Zero tolerance for `any`.
 */
export interface NormLookupContext {
  roomHeight?: number | null;
  roomArea?: number | null;
  detectorType?: string | null;
  roomType?: string | null;
  buildingType?: string | null;
  [key: string]: string | number | boolean | null | undefined;
}

export const NormLookupContextSchema = z
  .object({
    roomHeight: z.number().positive().nullable().optional(),
    roomArea: z.number().nonnegative().nullable().optional(),
    detectorType: z.string().trim().min(1).nullable().optional(),
    roomType: z.string().trim().min(1).nullable().optional(),
    buildingType: z.string().trim().min(1).nullable().optional(),
  })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

/**
 * Request payload sent to the norms search agent.
 */
export interface NormLookupRequest {
  query: string;
  context?: NormLookupContext | null;
}

export const NormLookupRequestSchema = z.object({
  query: z.string().trim().min(1, "Пошуковий запит не може бути порожнім"),
  context: NormLookupContextSchema.nullable().optional(),
});

/**
 * Result returned by the norms search agent.
 *
 * Missing or unverified clauses MUST default to null, never guessed placeholder strings.
 */
export interface NormLookupResult {
  document: string | null;
  clause: string | null;
  value: string | number | null;
  sourceUrl: string | null;
  checkedAt: string;
  status: NormVerificationStatus;
  summary: string;
  rawSnippet?: string | null;
}

export const NormLookupResultSchema = z
  .object({
    document: z.string().nullable(),
    clause: z.string().nullable(),
    value: z.union([z.string(), z.number()]).nullable(),
    sourceUrl: z.string().nullable(),
    checkedAt: z.string().datetime({ message: "checkedAt must be an ISO 8601 timestamp" }),
    status: NormVerificationStatusSchema,
    summary: z.string().trim().min(1, "Summary is required"),
    rawSnippet: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "found_in_official_source") {
      // 1. Document verification
      if (!data.document || data.document.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Verified norm result must specify an official document name",
          path: ["document"],
        });
      } else if (isDisallowedDocument(data.document)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Document "${data.document}" is an obsolete or disallowed standard`,
          path: ["document"],
        });
      }

      // 2. Clause verification
      if (!data.clause || data.clause.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Verified norm result must specify a concrete clause or table",
          path: ["clause"],
        });
      }

      // 3. Official Source URL verification
      if (!data.sourceUrl || data.sourceUrl.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Verified norm result must provide an official source URL",
          path: ["sourceUrl"],
        });
      } else if (!isOfficialDomain(data.sourceUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Source URL domain "${data.sourceUrl}" is not on the official Ukrainian whitelist`,
          path: ["sourceUrl"],
        });
      }
    } else if (data.status === "needs_verification") {
      // When status is 'needs_verification', document, clause, value, and sourceUrl can safely be null.
      // However, if a document name is provided, it must not refer to an obsolete/disallowed standard.
      if (data.document && isDisallowedDocument(data.document)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Document "${data.document}" is an obsolete or disallowed standard`,
          path: ["document"],
        });
      }
    }
  });

/**
 * Parameters to create a result marked as needing verification.
 * Missing or unverified fields strictly default to null.
 */
export interface CreateNeedsVerificationParams {
  summary: string;
  document?: string | null;
  clause?: string | null;
  value?: string | number | null;
  sourceUrl?: string | null;
  rawSnippet?: string | null;
  checkedAt?: string;
}

/**
 * Factory helper for creating an unverified result.
 * Enforces that missing/unverified values default to null, preventing hallucinated clauses.
 */
export function createNeedsVerificationResult(
  params: CreateNeedsVerificationParams
): NormLookupResult {
  const result: NormLookupResult = {
    document: params.document ?? null,
    clause: params.clause ?? null,
    value: params.value ?? null,
    sourceUrl: params.sourceUrl ?? null,
    checkedAt: params.checkedAt ?? new Date().toISOString(),
    status: "needs_verification",
    summary: params.summary,
    rawSnippet: params.rawSnippet ?? null,
  };

  return validateNormLookupResult(result);
}

/**
 * Parameters to create a verified norm result.
 */
export interface CreateVerifiedNormParams {
  document: string;
  clause: string;
  value: string | number | null;
  sourceUrl: string;
  summary: string;
  rawSnippet?: string | null;
  checkedAt?: string;
}

/**
 * Factory helper for creating a verified norm result with strict contract enforcement.
 */
export function createVerifiedNormResult(params: CreateVerifiedNormParams): NormLookupResult {
  const result: NormLookupResult = {
    document: params.document,
    clause: params.clause,
    value: params.value ?? null,
    sourceUrl: params.sourceUrl,
    checkedAt: params.checkedAt ?? new Date().toISOString(),
    status: "found_in_official_source",
    summary: params.summary,
    rawSnippet: params.rawSnippet ?? null,
  };

  return validateNormLookupResult(result);
}

/**
 * Validates a NormLookupRequest, throwing a ZodError if invalid.
 */
export function validateNormLookupRequest(input: unknown): NormLookupRequest {
  return NormLookupRequestSchema.parse(input);
}

/**
 * Safely parses a NormLookupRequest returning a result object.
 */
export function safeParseNormLookupRequest(
  input: unknown
): ReturnType<typeof NormLookupRequestSchema.safeParse> {
  return NormLookupRequestSchema.safeParse(input);
}

/**
 * Type guard for NormLookupRequest.
 */
export function isNormLookupRequest(input: unknown): input is NormLookupRequest {
  return NormLookupRequestSchema.safeParse(input).success;
}

/**
 * Validates a NormLookupResult, throwing a ZodError if invalid.
 */
export function validateNormLookupResult(input: unknown): NormLookupResult {
  return NormLookupResultSchema.parse(input);
}

/**
 * Safely parses a NormLookupResult returning a result object.
 */
export function safeParseNormLookupResult(
  input: unknown
): ReturnType<typeof NormLookupResultSchema.safeParse> {
  return NormLookupResultSchema.safeParse(input);
}

/**
 * Type guard for NormLookupResult.
 */
export function isNormLookupResult(input: unknown): input is NormLookupResult {
  return NormLookupResultSchema.safeParse(input).success;
}

/**
 * Helper to assert that a result with 'needs_verification' status can safely have null clause and document.
 */
export function canSafelyBeNullWhenUnverified(result: NormLookupResult): boolean {
  if (result.status !== "needs_verification") {
    return false;
  }
  return result.clause === null && result.document === null;
}
