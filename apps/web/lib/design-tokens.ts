import type { CSSProperties } from "react";
import tokens from "../../../tokens.json";

const designTokenGroups = {
  color: tokens.color,
  typography: tokens.typography,
  spacing: tokens.spacing,
  radius: tokens.radius,
  borderWidth: tokens.borderWidth,
  shadow: tokens.shadow,
  size: tokens.size,
  component: tokens.component,
  state: tokens.state,
  motion: tokens.motion,
  opacity: tokens.opacity,
};

function toKebabCase(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function addVariables(
  value: unknown,
  path: string[],
  variables: Record<string, string>,
): void {
  if (typeof value === "string" || typeof value === "number") {
    variables[`--bim-${path.map(toKebabCase).join("-")}`] = String(value);
    return;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, nestedValue] of Object.entries(value)) {
      addVariables(nestedValue, [...path, name], variables);
    }
  }
}

const variables: Record<string, string> = {};
for (const [name, group] of Object.entries(designTokenGroups)) {
  addVariables(group, [name], variables);
}

export const bimThemeVariables = variables as CSSProperties;
