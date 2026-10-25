import type { DrawingResult } from "@bim/contracts";

// Exact local fixture text (line endings normalized); tested against the API fixture.
// Bundled here so the explicit demo works offline without a backend or public file route.
export const DEMO_DXF = "0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$INSUNITS\r\n70\r\n4\r\n0\r\nENDSEC\r\n0\r\nSECTION\r\n2\r\nTABLES\r\n0\r\nTABLE\r\n2\r\nLAYER\r\n70\r\n1\r\n0\r\nLAYER\r\n2\r\nFIRE_ROOMS\r\n70\r\n0\r\n62\r\n7\r\n6\r\nCONTINUOUS\r\n0\r\nENDTAB\r\n0\r\nENDSEC\r\n0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLWPOLYLINE\r\n100\r\nAcDbEntity\r\n8\r\nFIRE_ROOMS\r\n100\r\nAcDbPolyline\r\n90\r\n4\r\n70\r\n1\r\n10\r\n0.0\r\n20\r\n0.0\r\n10\r\n4000.0\r\n20\r\n0.0\r\n10\r\n4000.0\r\n20\r\n5000.0\r\n10\r\n0.0\r\n20\r\n5000.0\r\n0\r\nTEXT\r\n100\r\nAcDbEntity\r\n8\r\nFIRE_ROOMS\r\n100\r\nAcDbText\r\n10\r\n2000.0\r\n20\r\n2500.0\r\n30\r\n0.0\r\n40\r\n250.0\r\n1\r\nRoom_101 (20.0m2)\r\n0\r\nLWPOLYLINE\r\n100\r\nAcDbEntity\r\n8\r\nFIRE_ROOMS\r\n100\r\nAcDbPolyline\r\n90\r\n4\r\n70\r\n1\r\n10\r\n4000.0\r\n20\r\n0.0\r\n10\r\n9000.0\r\n20\r\n0.0\r\n10\r\n9000.0\r\n20\r\n5000.0\r\n10\r\n4000.0\r\n20\r\n5000.0\r\n0\r\nTEXT\r\n100\r\nAcDbEntity\r\n8\r\nFIRE_ROOMS\r\n100\r\nAcDbText\r\n10\r\n6500.0\r\n20\r\n2500.0\r\n30\r\n0.0\r\n40\r\n250.0\r\n1\r\nRoom_102 (25.0m2)\r\n0\r\nLWPOLYLINE\r\n100\r\nAcDbEntity\r\n8\r\nFIRE_ROOMS\r\n100\r\nAcDbPolyline\r\n90\r\n4\r\n70\r\n1\r\n10\r\n0.0\r\n20\r\n5000.0\r\n10\r\n9000.0\r\n20\r\n5000.0\r\n10\r\n9000.0\r\n20\r\n9000.0\r\n10\r\n0.0\r\n20\r\n9000.0\r\n0\r\nTEXT\r\n100\r\nAcDbEntity\r\n8\r\nFIRE_ROOMS\r\n100\r\nAcDbText\r\n10\r\n4500.0\r\n20\r\n7000.0\r\n30\r\n0.0\r\n40\r\n250.0\r\n1\r\nRoom_103 (36.0m2)\r\n0\r\nENDSEC\r\n0\r\nEOF\n";

const drawingId = "bim60-simple-rooms-demo";
/** Demo-only presentation copy. Never called on uploaded/user drawings.
 * Read DXF code/value pairs so a coordinate value of 0 cannot split an entity.
 * Remove only the three fixture annotations, preserving every other entity/pair.
 */
export function createDemoDisplayDxf(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").trimEnd().split("\n");
  const labels = new Set(["Room_101 (20.0m2)", "Room_102 (25.0m2)", "Room_103 (36.0m2)"]);
  const output: string[] = [];
  let inEntities = false;
  for (let i = 0; i < lines.length;) {
    const code = lines[i].trim(), value = lines[i + 1]?.trim();
    if (code === "0" && value === "SECTION") inEntities = lines[i + 2]?.trim() === "2" && lines[i + 3]?.trim() === "ENTITIES";
    if (code === "0" && value === "ENDSEC") inEntities = false;
    if (inEntities && code === "0" && value === "TEXT") {
      let end = i + 2;
      while (end < lines.length && lines[end].trim() !== "0") end += 2;
      let text = "", layer = "";
      for (let j = i + 2; j < end; j += 2) {
        if (lines[j].trim() === "1") text = lines[j + 1];
        if (lines[j].trim() === "8") layer = lines[j + 1];
      }
      if (!(layer === "FIRE_ROOMS" && labels.has(text))) output.push(...lines.slice(i, end));
      i = end;
    } else {
      output.push(lines[i], lines[i + 1]);
      i += 2;
    }
  }
  return `${output.join("\n")}\n`;
}

export const DEMO_DISPLAY_DXF = createDemoDisplayDxf(DEMO_DXF);

export const DEMO_RESULT: DrawingResult = {
  drawing: {
    id: drawingId, ownerId: "local-demo", originalFileName: "01_simple_rooms_mm.dxf",
    storagePath: "demo/01_simple_rooms_mm.dxf", resolvedUnits: "mm", status: "processed",
    errorMessage: null, createdAt: "2026-10-23T00:00:00Z",
  },
  rooms: [
    { id: "room-101", drawingId, name: "Приміщення 101", type: null, height: null, area: 20,
      polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 5000 }, { x: 0, y: 5000 }] },
    { id: "room-102", drawingId, name: "Приміщення 102", type: null, height: null, area: 25,
      polygon: [{ x: 4000, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 5000 }, { x: 4000, y: 5000 }] },
    { id: "room-103", drawingId, name: "Приміщення 103", type: null, height: null, area: 36,
      polygon: [{ x: 0, y: 5000 }, { x: 9000, y: 5000 }, { x: 9000, y: 9000 }, { x: 0, y: 9000 }] },
  ],
  // Illustrative placements inside the fixture, not results of a fire safety calculation.
  devices: [
    { id: "demo-smoke", drawingId, roomId: "room-101", type: "smoke_detector", position: { x: 2000, y: 3500 }, layer: "FIRE_DEVICES" },
    { id: "demo-heat", drawingId, roomId: "room-102", type: "heat_detector", position: { x: 6500, y: 3500 }, layer: "FIRE_DEVICES" },
    { id: "demo-manual", drawingId, roomId: null, type: "manual_call_point", position: { x: 500, y: 5500 }, layer: "FIRE_DEVICES" },
    { id: "demo-sounder", drawingId, roomId: "room-103", type: "sounder", position: { x: 7500, y: 8000 }, layer: "FIRE_DEVICES" },
  ],
};
