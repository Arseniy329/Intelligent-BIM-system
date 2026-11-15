/**
 * Height parsing and validation helpers (BIM-72 / BIM-129 / BIM-82)
 */

export interface HeightValidationResult {
  isValid: boolean;
  value: number | null;
  error?: string;
}

export const HEIGHT_ERROR_MESSAGE = "Вкажіть висоту числом, більшим за 0.";

/**
 * Normalizes comma/dot decimal separators and validates that height is a positive number > 0.
 * Rejects empty, non-numeric, <= 0, or infinite values.
 */
export function parseHeightInput(value: string): HeightValidationResult {
  if (value == null) {
    return {
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    };
  }

  // Normalize comma to dot
  const normalized = trimmed.replace(",", ".");

  // Strict regex check for positive decimal format: e.g. "3", "3.0", "0.5"
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return {
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    };
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      isValid: false,
      value: null,
      error: HEIGHT_ERROR_MESSAGE,
    };
  }

  return {
    isValid: true,
    value: parsed,
  };
}

