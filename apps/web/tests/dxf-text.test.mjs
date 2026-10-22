import { readFile } from "node:fs/promises";
import { DxfFetcher } from "dxf-viewer";
// Integration tests intentionally exercise the pinned 1.0.50 font/scene pipeline,
// without mocking away font parsing or requiring WebGL. App code uses public APIs only.
import { DxfWorker } from "dxf-viewer/src/DxfWorker.js";
import { DxfScene } from "dxf-viewer/src/DxfScene.js";
import opentype from "opentype.js";
import { beforeAll, describe, expect, it } from "vitest";
import { DRAWING_FONT_URLS } from "@/lib/drawing/fonts";

const fontPath = new URL(`../public${DRAWING_FONT_URLS[0]}`, import.meta.url);
const ukrainianPath = new URL("./fixtures/dxf/04_ukrainian_text.dxf", import.meta.url);
let fontBytes;
let font;
let ukrainian;

async function withObjectUrl(bytes, action) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  try {
    return await action(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function buildText(entity) {
  const builder = new DxfScene();
  await builder.Build({ ...ukrainian, entities: [entity] }, [async () => font]);
  expect(builder.scene.numEntitiesSkipped).toBe(0);
  expect(builder.scene.hasMissingChars).toBe(false);
  expect(builder.scene.vertices.byteLength).toBeGreaterThan(0);
  return builder.scene.bounds;
}

beforeAll(async () => {
  fontBytes = await readFile(fontPath);
  font = opentype.parse(new Uint8Array(fontBytes).buffer);
  ukrainian = await withObjectUrl(await readFile(ukrainianPath), (url) => new DxfFetcher(url).Fetch());
});

describe("DXF TEXT/MTEXT with the shipped Noto Sans TTF", () => {
  it("contains Latin and the complete Ukrainian alphabet, including Ґ Є І Ї", () => {
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя0123456789²—") {
      expect(font.charToGlyphIndex(char), `missing glyph ${char}`).toBeGreaterThan(0);
    }
  });

  it.each([
    ["01_simple_rooms_mm.dxf", "../../api/tests/fixtures/test_drawing_dxf/"],
    ["02_cafe_office_plan_mm.dxf", "../../api/tests/fixtures/test_drawing_dxf/"],
    ["03_bad_unclosed_meters.dxf", "../../api/tests/fixtures/test_drawing_dxf/"],
    ["04_ukrainian_text.dxf", "./fixtures/dxf/"],
  ])("adds real text geometry to %s through the library font loader", async (name, directory) => {
    const data = await readFile(new URL(`${directory}${name}`, import.meta.url));
    await withObjectUrl(data, async (dxfUrl) => {
      await withObjectUrl(fontBytes, async (fontUrl) => {
        const worker = new DxfWorker(null);
        try {
          const withoutFont = await worker.Load(dxfUrl, [], {}, null);
          const phases = [];
          const withFont = await worker.Load(dxfUrl, [fontUrl], {}, (phase) => phases.push(phase));
          expect(phases).toContain("font");
          expect(withFont.scene.hasMissingChars).toBe(false);
          expect(withFont.scene.numEntitiesSkipped).toBe(0);
          expect(withFont.scene.vertices.byteLength).toBeGreaterThan(withoutFont.scene.vertices.byteLength);
        } finally {
          await worker.Destroy();
        }
      });
    });
  });

  it.each(["TEXT", "MTEXT"])("keeps %s geometry at its DXF insertion position", async (type) => {
    const entity = ukrainian.entities.find((item) => item.type === type);
    const key = type === "TEXT" ? "startPoint" : "position";
    const original = await buildText(entity);
    const moved = await buildText({
      ...entity, [key]: { ...entity[key], x: entity[key].x + 3000, y: entity[key].y - 2000 },
    });
    expect(moved.minX - original.minX).toBeCloseTo(3000);
    expect(moved.maxX - original.maxX).toBeCloseTo(3000);
    expect(moved.minY - original.minY).toBeCloseTo(-2000);
    expect(moved.maxY - original.maxY).toBeCloseTo(-2000);
  });

  it.each(["TEXT", "MTEXT"])("scales %s glyph geometry with the DXF text height", async (type) => {
    const entity = ukrainian.entities.find((item) => item.type === type);
    const key = type === "TEXT" ? "textHeight" : "height";
    const original = await buildText(entity);
    const larger = await buildText({ ...entity, [key]: entity[key] * 2 });
    expect(larger.maxX - larger.minX).toBeCloseTo((original.maxX - original.minX) * 2);
    expect(larger.maxY - larger.minY).toBeCloseTo((original.maxY - original.minY) * 2);
  });

  it("preserves the 90 degree TEXT rotation", async () => {
    const entity = ukrainian.entities.find((item) => item.type === "TEXT" && item.rotation === 90);
    const rotated = await buildText(entity);
    const straight = await buildText({ ...entity, rotation: 0 });
    expect(rotated.maxY - rotated.minY).toBeCloseTo(straight.maxX - straight.minX);
    expect(rotated.maxX - rotated.minX).toBeCloseTo(straight.maxY - straight.minY);
  });
});
