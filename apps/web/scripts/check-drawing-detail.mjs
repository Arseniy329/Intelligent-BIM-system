// Run from repository root with Next on :3100 and Chrome CDP on :9334.
// Next environment: NEXT_PUBLIC_API_URL=http://127.0.0.1:4318,
// NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4318,
// NEXT_PUBLIC_SUPABASE_ANON_KEY=bim63-local-test-only, NEXT_PUBLIC_DRAWING_DEMO=true.
// Local test server only. Never point a deployed application at this auth stub.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const output = process.env.BIM_EXPECT_DEMO === "false" ? "tmp/bim63-production" : "tmp/bim63";
await mkdir(output, { recursive: true });
const origin = "http://127.0.0.1:4318";
const app = process.env.BIM_APP_URL ?? "http://localhost:3100";
const fixture = await readFile("apps/api/tests/fixtures/test_drawing_dxf/01_simple_rooms_mm.dxf", "utf8");
const rooms = [
  { id: "r1", name: "Перша кімната", area: 20, polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 5000 }, { x: 0, y: 5000 }] },
  { id: "r2", name: "Друга кімната", area: 25, polygon: [{ x: 4000, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 5000 }, { x: 4000, y: 5000 }] },
];
const expires = Math.floor(Date.now() / 1000) + 3600;
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "test@example.invalid" };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...user, sub: user.id, exp: expires, iat: expires - 3600 })}.local-test-signature`;
const session = { access_token: token, refresh_token: "local-test-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
const states = new Map();
const calls = [];
let revision = 0;
let failure = null;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  response.setHeader("Access-Control-Allow-Origin", app);
  response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, x-client-info, content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  const json = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  if (url.pathname === "/auth/v1/user") { json(user); return; }
  if (url.pathname.startsWith("/file/")) {
    calls.push({ path: url.pathname, revision: url.searchParams.get("revision"), auth: !!request.headers.authorization });
    if (failure === "file") { response.writeHead(403).end(); return; }
    response.writeHead(200, { "Content-Type": "application/dxf" }); response.end(fixture); return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) { json({}, 401); return; }
  const segments = url.pathname.split("/");
  const id = segments[2];
  calls.push({ path: url.pathname, method: request.method });
  if (segments[1] === "processing-jobs") {
    const drawingId = id.replace(/^job-/, "");
    const state = states.get(drawingId);
    const complete = drawingId !== "slow" && Date.now() > state.readyAt;
    if (complete) state.status = drawingId === "failed" ? "error" : "processed";
    json({ id, drawingId, status: complete ? drawingId === "failed" ? "failed" : "completed" : "processing", errorMessage: null }); return;
  }
  if (segments[1] !== "drawings") { json({}, 404); return; }
  if (failure === "network") { request.socket.destroy(); return; }
  if (typeof failure === "number") { json({}, failure); return; }
  let state = states.get(id);
  if (!state) { state = { status: ["empty", "room-only", "ready"].includes(id) ? "processed" : "uploaded", readyAt: 0 }; states.set(id, state); }
  if (request.method === "POST") {
    state.status = "processing"; state.readyAt = Date.now() + 700;
    // Delay the response to exercise the synchronous double-click lock.
    setTimeout(() => json({ id: `job-${id}`, drawingId: id, status: "queued", errorMessage: null }), 300); return;
  }
  const drawing = { id, ownerId: user.id, originalFileName: `${id}.dxf`, storagePath: `test/${id}.dxf`, status: state.status, createdAt: "2026-10-25T00:00:00Z" };
  const link = `${origin}/file/${id}?revision=${++revision}`;
  const expiry = new Date(Date.now() + (failure === "expired" ? -1000 : 3600000)).toISOString();
  if (state.status === "processed") json({
    drawing: { ...drawing, resolvedUnits: "mm" },
    rooms: id === "empty" ? [] : rooms.map(room => ({ ...room, drawingId: id, type: null, height: null })),
    devices: ["empty", "room-only"].includes(id) ? [] : [{ id: "smoke", drawingId: id, roomId: "r1", type: "smoke_detector", position: { x: 2000, y: 2500 }, layer: "FIRE_DEVICES" }],
    downloadUrl: failure === "missing" ? null : link, downloadUrlExpiresAt: expiry,
  });
  else json({ ...drawing, units: "mm", sourceDownloadUrl: failure === "missing" ? null : link, sourceDownloadUrlExpiresAt: expiry });
});
await new Promise(resolve => server.listen(4318, "127.0.0.1", resolve));
const pages = await (await fetch(`${process.env.BIM_CDP_URL ?? "http://127.0.0.1:9334"}/json/list`)).json();
const socket = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const results = [];
const exceptions = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
};
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
  throw Error(`Timed out: ${expression}`);
}
function check(name, condition = true) { assert(condition, name); results.push(name); console.log(`PASS ${name}`); }
const body = text => `document.body.textContent.includes(${JSON.stringify(text)})`;
async function click(text) { await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`); }
async function navigate(path) { await cdp("Page.navigate", { url: `${app}${path}` }); await until("document.readyState === 'complete'"); }
async function ready() { await until(`${body("Креслення готове до перегляду.")} && !!document.querySelector('canvas')`); }
async function screenshot(name) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(`${output}/${name}.png`, Buffer.from(data, "base64"));
}
try {
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Network.clearBrowserCookies");
  await navigate("/drawings/first");
  await until("location.pathname === '/login'");
  check("protected route redirects without a session, including with demo flag enabled");
  await cdp("Network.setCookie", { name: "sb-127-auth-token", value: `base64-${encode(session)}`, url: app, path: "/", sameSite: "Lax" });
  await navigate("/drawings/first"); await ready();
  check("protected ID route opens source DXF before processing", await evaluate(body("Завантажити оригінальний DXF")));
  await evaluate("window.__canvas = document.querySelector('canvas')");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Обробити').click(); Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Обробити')?.click()");
  await until(body("Обробка…"));
  await until(body("Приміщень: 2 · Сповіщувачів: 1"));
  check("POST processing updates results and prevents duplicate starts", calls.filter(call => call.path === "/drawings/first/process").length === 1);
  check("new result retains loaded source canvas", await evaluate("window.__canvas === document.querySelector('canvas')"));
  check("API rooms and devices reach overlay", await evaluate("document.querySelectorAll('[data-room-id]').length === 2 && document.querySelectorAll('[data-device-id]').length === 1"));
  const loads = calls.filter(call => call.path.startsWith("/file/")).length;
  await click("Приміщення"); await click("Приміщення"); await click("Сповіщувачі"); await click("Сповіщувачі");
  await click("Оновити стан"); await delay(300);
  check("layer toggles and refreshed signed URLs do not reload DXF", calls.filter(call => call.path.startsWith("/file/")).length === loads && await evaluate("window.__canvas === document.querySelector('canvas')"));
  await screenshot("result-desktop");
  // Capture file delivery without leaving artifacts in the user's Downloads folder.
  await evaluate("window.__saved = []; HTMLAnchorElement.prototype.click = function(){window.__saved.push(this.download)}");
  const beforeDownload = calls.length;
  await click("Завантажити DXF результату"); await until(body("DXF передано браузеру"));
  const downloadCalls = calls.slice(beforeDownload);
  check("download GETs fresh metadata then fetches the file without bearer credentials", downloadCalls[0].path === "/drawings/first" && downloadCalls[1].path === "/file/first" && !downloadCalls[1].auth);
  check("generated DXF uses a distinct filename", await evaluate("window.__saved[0] === 'first-processed.dxf'"));
  for (const [mode, message] of [["expired", "Термін дії"], ["missing", "Посилання на цей DXF ще недоступне"], ["file", "Посилання відхилено"]]) {
    failure = mode; await click("Завантажити DXF результату"); await until(body(message)); check(`download reports ${mode}`);
  }
  failure = null;
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(300);
  check("mobile layout fits viewport", await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await screenshot("result-mobile");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Exercise real App Router navigation without a full document reload.
  await evaluate("window.next.router.push('/drawings/empty')");
  await until("location.pathname === '/drawings/empty'"); await until(body("Приміщень: 0 · Сповіщувачів: 0"));
  check("client navigation clears previous drawing overlay", await evaluate("!document.querySelector('[data-room-id]') && !document.querySelector('[data-device-id]')"));
  await navigate("/drawings/room-only"); await ready();
  check("rooms without detectors render", await evaluate(`${body("Приміщень: 2 · Сповіщувачів: 0")} && document.querySelectorAll('[data-room-id]').length === 2`));
  await navigate("/drawings/first"); await ready();
  check("reopening processed drawing restores results", await evaluate(body("Приміщень: 2 · Сповіщувачів: 1")));
  for (const [status, message] of [[401, "Сеанс завершився"], [403, "немає доступу"], [404, "не знайдено"], ["network", "Перевірте з’єднання"]]) {
    failure = status; await navigate(`/drawings/error-${status}`); await until(body(message));
    failure = null; await click("Спробувати знову"); await ready(); check(`GET ${status} recovers through user retry`);
  }
  await navigate("/drawings/failed"); await ready(); await click("Обробити");
  await until(body("Не вдалося обробити креслення"));
  check("failed asynchronous job allows another attempt", await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Обробити' && !b.disabled)"));
  // Accelerate only the deadline, preserving normal polling intervals.
  const timerScript = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "const originalTimer = window.setTimeout; window.setTimeout = (fn, ms, ...args) => originalTimer(fn, ms === 120000 ? 2500 : ms, ...args);" });
  await navigate("/drawings/slow"); await ready(); await click("Обробити");
  await until(body("Автоматичне оновлення зупинено"));
  const afterTimeout = calls.length; await delay(2300);
  check("polling stops at deadline", calls.length === afterTimeout);
  await click("Оновити стан"); await delay(100);
  check("manual refresh resumes status checks", calls.length > afterTimeout);
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: timerScript.identifier });
  await navigate("/drawing-preview?result=true");
  if (process.env.BIM_EXPECT_DEMO === "false") {
    await until("!!document.querySelector('input[type=file]')");
    check("production ignores result-demo flag and query parameter", !await evaluate(body("Відкрити демо результату")));
    await cdp("Network.clearBrowserCookies");
    await navigate("/drawing-preview?result=true");
    await until("location.pathname === '/login'");
    check("production demo URL still requires authentication");
  } else {
    await until(body("Відкрити демо результату")); await click("Відкрити демо результату"); await ready();
    const beforeDemo = calls.length;
    await click("Обробити"); await until(body("Приміщень: 3 · Сповіщувачів: 4"));
    check("explicit BIM-60 fixture demo runs without API calls", calls.length === beforeDemo);
    await evaluate("const select = document.querySelector('select'); select.value='demo-empty'; select.dispatchEvent(new Event('change',{bubbles:true}))");
    await until(body("demo-empty.dxf")); await click("Обробити"); await until(body("Приміщень: 0 · Сповіщувачів: 0"));
    check("demo ID change clears prior rooms and devices", await evaluate("!document.querySelector('[data-room-id]') && !document.querySelector('[data-device-id]')"));
  }
  check("no uncaught browser exceptions", exceptions.length === 0);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, exceptions, scope: "Local mocked API/auth; real backend acceptance remains blocked by BIM-47." }, null, 2));
  socket.close(); server.closeAllConnections(); server.close();
}
