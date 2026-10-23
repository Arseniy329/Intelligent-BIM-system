// Run from the repository root against a running app and a Chrome CDP instance.
// BIM_PREVIEW_URL defaults to http://localhost:3100/drawing-preview;
// BIM_CDP_URL defaults to http://127.0.0.1:9334. No browser dependency is installed.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = "tmp/bim60-layer-browser";
await mkdir(output, { recursive: true });
const pages = await (await fetch(`${process.env.BIM_CDP_URL ?? "http://127.0.0.1:9334"}/json/list`)).json();
const page = pages.find((item) => item.type === "page");
assert(page, "Chrome must have an open tab");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const exceptions = [];
const results = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params);
};
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw Error(`Timed out: ${expression}`);
}
function check(name, value) { assert(value, name); results.push(name); console.log(`PASS ${name}`); }
async function click(label) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
  await delay(150);
}
const ready = () => until(`document.body.textContent.includes('Креслення готове до перегляду.') && !!document.querySelector('canvas')`);
const overlayReady = () => until(`document.querySelectorAll('[data-device-id]').length === 4 && document.querySelectorAll('[data-room-id]').length === 3`);
async function screenshot(name) {
  const { cssContentSize: size } = await cdp("Page.getLayoutMetrics");
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
  await writeFile(`${output}/${name}.png`, Buffer.from(data, "base64"));
}
async function openFile(file) {
  const { root } = await cdp("DOM.getDocument");
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [path.resolve(file)] });
  await ready();
}
const snapshot = () => evaluate(`(() => {
  const polygon = document.querySelector('[data-room-id="room-101"]');
  const points = Array.from(polygon.points).map(p => ({x:p.x,y:p.y}));
  const marker = document.querySelector('[data-device-id="demo-smoke"]');
  const rect = marker.getBoundingClientRect(), svg = marker.querySelector('svg').getBoundingClientRect();
  return {points, x:parseFloat(marker.style.left), y:parseFloat(marker.style.top), width:rect.width, height:rect.height, glyph:svg.width};
})()`);
function aligned(state) {
  // Smoke position (2000,3500) is 1/2 along X, 7/10 along Y of room 101.
  const [a, b, , d] = state.points;
  return Math.abs(state.x - (a.x + (b.x - a.x) * 0.5)) < 0.01 && Math.abs(state.y - (a.y + (d.y - a.y) * 0.7)) < 0.01;
}
const labelsContained = () => evaluate(`(() => {
  const overlay = document.querySelector('[data-drawing-overlay]').getBoundingClientRect();
  const labels = Array.from(document.querySelectorAll('[data-room-label]'));
  return labels.length === 3 && labels.every(label => {
    const r = label.getBoundingClientRect();
    const points = Array.from(document.querySelector('[data-room-id="' + label.dataset.roomLabel + '"]').points);
    const left = Math.max(overlay.left, overlay.left + Math.min(...points.map(p => p.x)));
    const right = Math.min(overlay.right, overlay.left + Math.max(...points.map(p => p.x)));
    const top = Math.max(overlay.top, overlay.top + Math.min(...points.map(p => p.y)));
    const bottom = Math.min(overlay.bottom, overlay.top + Math.max(...points.map(p => p.y)));
    return r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom;
  });
})()`);
const layerSnapshot = () => evaluate(`(() => {
  const origin = document.querySelector('[data-drawing-overlay]').getBoundingClientRect();
  const box = el => { const r = el.getBoundingClientRect(); return [r.left-origin.left,r.top-origin.top,r.width,r.height]; };
  return {
    // Ignore only floating-point roundoff (~1e-13 px) from camera matrices after resize.
    rooms: Array.from(document.querySelectorAll('[data-room-id]')).map(el => [el.dataset.roomId, el.getAttribute('points').split(/[ ,]+/).map(v => Math.round(Number(v) * 1e6) / 1e6)]),
    labels: Array.from(document.querySelectorAll('[data-room-label]')).map(el => [el.dataset.roomLabel, el.textContent, box(el)]),
    devices: Array.from(document.querySelectorAll('[data-device-id]')).map(el => [el.dataset.deviceId, box(el)]),
  };
})()`);
async function setLayers(rooms, devices, labels) {
  for (const [name, visible] of [["Приміщення", rooms], ["Сповіщувачі", devices], ["Підписи", labels]]) {
    const pressed = await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(name)}).getAttribute('aria-pressed') === 'true'`);
    if (pressed !== visible) await click(name);
  }
}
async function checkLayerCombinations(context) {
  await setLayers(true, true, true);
  const baseline = await layerSnapshot();
  const loads = await evaluate("window.__dxfLoads");
  // Includes changing label preference while rooms are hidden, then restoring rooms.
  for (const rooms of [false, true]) for (const labels of [false, true]) for (const devices of [false, true]) {
    await setLayers(rooms, devices, labels);
    const current = await layerSnapshot();
    assert.deepEqual(current, {
      rooms: rooms ? baseline.rooms : [],
      labels: rooms && labels ? baseline.labels : [],
      devices: devices ? baseline.devices : [],
    }, `Coordinate/visibility regression: ${context}, rooms=${rooms}, devices=${devices}, labels=${labels}`);
    check(`${context}: rooms=${rooms}, devices=${devices}, labels=${labels} preserve other coordinates`,
      await evaluate(`window.__dxfLoads === ${loads} && window.__originalCanvas === document.querySelector('canvas')`));
    if (!rooms && !labels && !devices) await screenshot(`all-layers-off-${context}`);
  }
  await setLayers(true, true, true);
}
try {
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: process.env.BIM_PREVIEW_URL ?? "http://localhost:3100/drawing-preview" });
  await until(`document.readyState === 'complete' && !!document.querySelector('input[type=file]')`);
  await delay(500);
  await evaluate(`window.__dxfLoads = 0; const originalFetch = window.fetch; window.fetch = async (...args) => {
    const blob = String(args[0]).startsWith('blob:');
    if (blob) window.__dxfLoads++;
    const response = await originalFetch(...args);
    if (blob) window.__lastDxfText = await response.clone().text();
    return response;
  };`);
  check("empty preview has no overlay", await evaluate(`!document.querySelector('[data-drawing-overlay]')`));
  await click("Відкрити демо оверлею"); await ready(); await overlayReady();
  await evaluate(`window.__originalCanvas = document.querySelector('canvas'); document.querySelector('canvas').scrollIntoView({block:'center'});`);
  const initial = await snapshot();
  check("three polygons and four markers align with fixture WCS", aligned(initial));
  check("areas are already square metres", await evaluate(`['20 м²','25 м²','36 м²'].every(s => document.body.textContent.includes(s))`));
  check("only markers intercept pointer events", await evaluate(`getComputedStyle(document.querySelector('[data-drawing-overlay]')).pointerEvents === 'none' && getComputedStyle(document.querySelector('[data-device-id]')).pointerEvents === 'auto'`));
  await screenshot("demo-fit");
  check("demo has one Room[] label set and no native English annotations in loaded DXF", await evaluate(`document.querySelectorAll('[data-room-label]').length === 3 && !/Room_10[123]/.test(window.__lastDxfText)`));
  check("all four device glyphs are 20 CSS px and keep 40 px hit targets", await evaluate(`Array.from(document.querySelectorAll('[data-device-id]')).every(marker => marker.getBoundingClientRect().width === 40 && marker.querySelector('svg').getBoundingClientRect().width === 20)`));
  check("enabled labels fit entirely inside their room polygons", await labelsContained());
  await screenshot("demo-labels-enabled");
  await checkLayerCombinations("fit");
  for (let i = 0; i < 10; i++) await evaluate(`document.querySelector('[aria-label="Зменшити масштаб"]').click()`);
  await delay(200);
  check("small rooms omit labels rather than spill across walls, full information remains accessible", await evaluate(`!document.querySelector('[data-room-label]') && document.querySelector('[aria-label="Назви та площі приміщень"]').textContent.includes('20 м²')`));
  await click("Вмістити все");
  check("fit restores labels with valid bounds", await labelsContained());

  await click("Приміщення");
  check("room toggle leaves devices visible", await evaluate(`document.querySelectorAll('[data-room-id]').length === 0 && document.querySelectorAll('[data-device-id]').length === 4`));
  await click("Сповіщувачі");
  check("hidden devices leave no keyboard targets", await evaluate(`document.querySelectorAll('[data-device-id]').length === 0 && !document.querySelector('[role=tooltip]')`));
  await click("Приміщення");
  check("room toggle does not enable devices", await evaluate(`document.querySelectorAll('[data-room-id]').length === 3 && document.querySelectorAll('[data-device-id]').length === 0`));
  await click("Сповіщувачі"); await overlayReady();

  await evaluate(`document.querySelector('[aria-label="Збільшити масштаб"]').click()`); await delay(200);
  const zoomed = await snapshot();
  await checkLayerCombinations("zoom");
  check("label rectangles remain contained after zoom", await labelsContained());
  check("zoom preserves marker size and WCS alignment", aligned(zoomed) && zoomed.width === initial.width && zoomed.glyph === initial.glyph && Math.abs((zoomed.points[1].x - zoomed.points[0].x) / (initial.points[1].x - initial.points[0].x) - 1.25) < 0.01);
  await click("Вмістити все"); await delay(200);
  const canvasRect = await evaluate(`(() => {const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+120,y:r.y+100};})()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...canvasRect });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...canvasRect, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: canvasRect.x + 60, y: canvasRect.y + 35, button: "left", buttons: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: canvasRect.x + 60, y: canvasRect.y + 35, button: "left", clickCount: 1 });
  await delay(200);
  const panned = await snapshot();
  check("mouse drag passes through overlay and moves anchors together", aligned(panned) && Math.abs(panned.x - initial.x) > 10);
  check("labels stay contained after pan", await labelsContained());
  await checkLayerCombinations("pan");
  await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: canvasRect.x + 60, y: canvasRect.y + 35, deltaX: 0, deltaY: -80 });
  await delay(200);
  check("wheel zoom keeps anchors aligned", aligned(await snapshot()));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 960, height: 800, deviceScaleFactor: 2, mobile: false });
  await delay(300); await click("Вмістити все");
  const resized = await snapshot();
  await checkLayerCombinations("resize");
  check("label rectangles remain contained after resize at DPR 2", await labelsContained());
  check("resize and DPR 2 use CSS pixels with fixed marker size", aligned(resized) && resized.width === initial.width && resized.glyph === initial.glyph);
  check("zoom/pan/resize/toggles reuse canvas and do not load DXF again", await evaluate(`window.__dxfLoads === 1 && window.__originalCanvas === document.querySelector('canvas')`));

  await evaluate(`document.querySelector('[data-device-id="demo-smoke"]').focus()`);
  await until(`!!document.querySelector('[role=tooltip]')`);
  check("keyboard focus shows type, room and description", await evaluate(`document.querySelector('[role=tooltip]').textContent.includes('Димовий сповіщувач') && document.querySelector('[role=tooltip]').textContent.includes('Приміщення 101') && document.activeElement.getAttribute('aria-describedby') === document.querySelector('[role=tooltip]').id`));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await until(`!document.querySelector('[role=tooltip]')`);
  check("Escape dismisses tooltip", true);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await until(`document.activeElement?.dataset.deviceId === 'demo-heat'`);
  check("Tab reaches the next marker", true);
  await evaluate(`document.querySelector('[data-device-id="demo-manual"]').focus()`);
  await until(`document.querySelector('[role=tooltip]')?.textContent.includes('Приміщення не визначено')`);
  check("null room reference has a neutral tooltip", true);
  check("tooltip remains inside the stage", await evaluate(`(() => {const a=document.querySelector('[role=tooltip]').getBoundingClientRect(),b=document.querySelector('[data-drawing-overlay]').getBoundingClientRect();return a.left>=b.left && a.top>=b.top && a.right<=b.right && a.bottom<=b.bottom;})()`));
  await screenshot("demo-keyboard-tooltip");
  await evaluate(`document.activeElement.blur()`);
  const markerPosition = await evaluate(`(() => {const r=document.querySelector('[data-device-id="demo-heat"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...markerPosition });
  await until(`document.querySelector('[role=tooltip]')?.textContent.includes('Тепловий сповіщувач')`);
  check("pointer hover opens tooltip", true);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });

  await evaluate(`document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', {bubbles:true,cancelable:true}))`);
  await until(`document.body.textContent.includes('Втрачено WebGL-контекст') && !document.querySelector('[data-drawing-overlay]')`);
  await click("Спробувати знову"); await ready(); await overlayReady();
  check("context-loss retry removes stale overlay and mounts exactly one new overlay", await evaluate(`document.querySelectorAll('[data-drawing-overlay]').length === 1 && window.__originalCanvas !== document.querySelector('canvas')`));

  for (const name of ["01_simple_rooms_mm.dxf", "02_cafe_office_plan_mm.dxf", "03_bad_unclosed_meters.dxf"]) {
    await openFile(`apps/api/tests/fixtures/test_drawing_dxf/${name}`);
    check(`local ${name} opens without demo data`, await evaluate(`!document.querySelector('[data-drawing-overlay]') && !document.querySelector('[aria-pressed]')`));
    if (name === "01_simple_rooms_mm.dxf") check("normal-mode DXF keeps all three native English labels", await evaluate(`['Room_101','Room_102','Room_103'].every(text => window.__lastDxfText.includes(text))`));
  }
  await openFile("apps/web/tests/fixtures/dxf/04_ukrainian_text.dxf");
  check("BIM-59 Ukrainian TEXT/MTEXT opens unchanged", await evaluate(`!document.querySelector('[data-drawing-overlay]') && window.__lastDxfText.includes('Ґґ Єє Іі Її')`));
  await evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File(['not a DXF'],'broken.dxf'));document.querySelector('main').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()`);
  await until(`document.body.textContent.includes('Не вдалося відкрити DXF')`);
  await click("Спробувати знову");
  await until(`document.body.textContent.includes('Не вдалося відкрити DXF')`);
  check("malformed file supports error and retry", true);
  await click("Відкрити демо оверлею"); await ready(); await overlayReady();
  check("reopened demo restores Room[] labels without native duplicates", await evaluate(`document.querySelectorAll('[data-room-label]').length === 3 && !/Room_10[123]/.test(window.__lastDxfText)`));
  await click("Закрити креслення");
  await until(`!document.querySelector('canvas') && !document.querySelector('[data-drawing-overlay]')`);
  check("close removes canvas and overlay", true);

  const heavy = "apps/api/tests/fixtures/test_drawing_dxf/wooden-gothic-house-mini-two-floor-dollhouse-for-laser-cut-free.dxf";
  if (await readFile(heavy).then(() => true, () => false)) {
    await openFile(heavy);
    check("heavy DXF opens without demo overlays", await evaluate(`!document.querySelector('[data-drawing-overlay]')`));
    await evaluate(`window.__heavyCanvas=document.querySelector('canvas');document.querySelector('[aria-label="Збільшити масштаб"]').click()`);
    await click("Вмістити все");
    check("heavy DXF zoom/fit retain canvas", await evaluate(`window.__heavyCanvas === document.querySelector('canvas')`));
    await evaluate(`document.querySelector('canvas').scrollIntoView({block:'center'}); window.__heavyLoads=window.__dxfLoads;`);
    const heavyBefore = await cdp("Page.captureScreenshot", { format: "png" });
    const heavyPoint = await evaluate(`(() => {const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+120,y:r.y+100};})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...heavyPoint });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...heavyPoint, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: heavyPoint.x + 60, y: heavyPoint.y + 35, button: "left", buttons: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: heavyPoint.x + 60, y: heavyPoint.y + 35, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", ...heavyPoint, deltaX: 0, deltaY: -80 });
    await delay(200);
    const heavyAfter = await cdp("Page.captureScreenshot", { format: "png" });
    check("heavy DXF responds to mouse pan and wheel", heavyBefore.data !== heavyAfter.data);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(200); await click("Вмістити все");
    check("heavy DXF pan/wheel/resize reuse canvas without another Load", await evaluate(`window.__heavyCanvas === document.querySelector('canvas') && window.__heavyLoads === window.__dxfLoads`));
    await screenshot("heavy-fit");
    await click("Закрити креслення");
    await openFile(heavy);
    check("heavy DXF reopens", true);
  }
  check("no uncaught browser exceptions", exceptions.length === 0);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, exceptions, scope: "Chrome CDP browser checks, not native Windows Explorer or manual headed acceptance" }, null, 2));
  socket.close();
}
