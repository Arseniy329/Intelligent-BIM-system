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

function validateDefinition(definition: string, value: unknown) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  expect(validate, `missing schema ${definition}`).toBeTypeOf("function");
  return validate?.(value) ?? false;
}

describe("JSON contract examples", () => {
  it.each([
    ["create-drawing-request.json", "CreateDrawingRequest"],
    ["create-drawing-response.json", "CreateDrawingResponse"],
    ["drawing-result.json", "DrawingResult"],
    ["processing-job.json", "ProcessingJob"],
  ])("validates %s", (fileName, definition) => {
    expect(validateDefinition(definition, readExample(fileName))).toBe(true);
  });

  it("rejects from_file as resolved drawing units", () => {
    const response = readExample("create-drawing-response.json");
    response.drawing.resolvedUnits = "from_file";

    expect(validateDefinition("CreateDrawingResponse", response)).toBe(false);
  });

  it("rejects an internal result storage path in the public drawing", () => {
    const result = readExample("drawing-result.json");
    result.drawing.resultStoragePath = "private/result.dxf";

    expect(validateDefinition("DrawingResult", result)).toBe(false);
  });

  it("rejects a polygon that repeats its first point", () => {
    const result = readExample("drawing-result.json");
    result.rooms[0].polygon.push(result.rooms[0].polygon[0]);

    expect(validateDefinition("DrawingResult", result)).toBe(false);
  });
});
