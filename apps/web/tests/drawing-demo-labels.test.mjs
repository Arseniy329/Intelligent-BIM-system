import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { DxfFetcher } from "dxf-viewer";
import { DEMO_DXF, DEMO_DISPLAY_DXF, createDemoDisplayDxf } from "@/lib/drawing/demo-drawing";

let original, display;
async function parse(text) {
  const url = URL.createObjectURL(new Blob([text]));
  try { return await new DxfFetcher(url).Fetch(); }
  finally { URL.revokeObjectURL(url); }
}
beforeAll(async () => {
  [original, display] = await Promise.all([parse(DEMO_DXF), parse(DEMO_DISPLAY_DXF)]);
});

it("removes precisely the three native room annotations from the demo copy", () => {
  expect(original.entities.filter(e => e.type === "TEXT").map(e => e.text)).toEqual([
    "Room_101 (20.0m2)", "Room_102 (25.0m2)", "Room_103 (36.0m2)",
  ]);
  expect(display.entities).toHaveLength(original.entities.length - 3);
  expect(display.entities.some(e => e.type === "TEXT")).toBe(false);
  expect(DEMO_DISPLAY_DXF).not.toMatch(/Room_10[123]/);
});

it("preserves geometry, header and layer tables", () => {
  // Parser-generated handles depend on entity order; this fixture has no explicit handles.
  const withoutHandle = ({ handle, ...entity }) => { void handle; return entity; };
  expect(display.entities.map(withoutHandle)).toEqual(original.entities.filter(e => e.type !== "TEXT").map(withoutHandle));
  expect(display.header).toEqual(original.header);
  expect(display.tables).toEqual(original.tables);
});

it("keeps unrelated TEXT/MTEXT, zero coordinates and the same name on another layer", async () => {
  const extra = [
    "0", "TEXT", "8", "FIRE_ROOMS", "10", "0", "20", "0", "40", "250", "1", "Exit — Вихід",
    "0", "TEXT", "8", "NOTES", "10", "0", "20", "0", "40", "250", "1", "Room_101 (20.0m2)",
    "0", "MTEXT", "8", "FIRE_ROOMS", "10", "0", "20", "0", "40", "250", "1", "Room_102 (25.0m2)",
  ].join("\n") + "\n";
  const input = DEMO_DXF.replaceAll("\r\n", "\n").replace("0\nENDSEC\n0\nEOF", extra + "0\nENDSEC\n0\nEOF");
  const filtered = createDemoDisplayDxf(input);
  expect(filtered).toContain(extra);
  const parsed = await parse(filtered);
  expect(parsed.entities.filter(e => e.type === "TEXT" || e.type === "MTEXT").map(e => e.text)).toEqual([
    "Exit — Вихід", "Room_101 (20.0m2)", "Room_102 (25.0m2)",
  ]);
});

it("leaves the original fixture and its normal-mode annotations unchanged", async () => {
  const source = await readFile(new URL("../../api/tests/fixtures/test_drawing_dxf/01_simple_rooms_mm.dxf", import.meta.url), "utf8");
  expect(DEMO_DXF.replaceAll("\r\n", "\n").trim()).toBe(source.replaceAll("\r\n", "\n").trim());
  expect((await parse(source)).entities.filter(e => e.type === "TEXT")).toEqual(original.entities.filter(e => e.type === "TEXT"));
});
