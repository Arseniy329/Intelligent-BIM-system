import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DxfFetcher } from "dxf-viewer";
import { describe, expect, it } from "vitest";

describe("published dxf-viewer parser with BIM-67 fixtures (without WebGL)", () => {
  it.each([
    ["01_simple_rooms_mm.dxf", 3],
    ["02_cafe_office_plan_mm.dxf", 10],
    ["03_bad_unclosed_meters.dxf", 2],
  ])("reads local geometry in %s", async (name, polylines) => {
    const path = fileURLToPath(new URL(`../../api/tests/fixtures/test_drawing_dxf/${name}`, import.meta.url));
    const data = await readFile(path);
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)]));
    try {
      const parsed = await new DxfFetcher(url).Fetch() as { entities: { type: string }[] };
      expect(parsed.entities.filter((entity) => entity.type === "LWPOLYLINE")).toHaveLength(polylines);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});
