import { Ajv2020 } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(
  readFileSync(path.join(packageRoot, "schemas", "contracts.schema.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
ajv.addFormat("date-time", (value) => !Number.isNaN(Date.parse(value)));
ajv.addFormat("uri", (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
});
ajv.addSchema(schema);

function readExample(name: string) {
  return JSON.parse(readFileSync(path.join(packageRoot, "examples", name), "utf8"));
}

describe("JSON contract examples", () => {
  it.each([
    ["create-drawing-request.json", "CreateDrawingRequest"],
    ["create-drawing-response.json", "CreateDrawingResponse"],
    ["drawing-result.json", "DrawingResult"],
  ])("validates %s", (fileName, definition) => {
    const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
    expect(validate, `missing schema ${definition}`).toBeTypeOf("function");
    expect(validate?.(readExample(fileName)), JSON.stringify(validate?.errors)).toBe(true);
  });
});
