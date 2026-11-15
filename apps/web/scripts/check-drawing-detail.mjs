// Run from repository root with Next on :3100 and Chrome CDP on :9334.
// Next environment: NEXT_PUBLIC_API_URL=http://127.0.0.1:4318,
// NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4318,
// NEXT_PUBLIC_SUPABASE_ANON_KEY=bim63-local-test-only, NEXT_PUBLIC_DRAWING_DEMO=true.
// Local test server only. Never point a deployed application at this auth stub.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const output = process.env.BIM_EXPECT_DEMO === "false" ? "tmp/bim63-production" : "tmp/bim63";
await mkdir(output, { recursive: true });
const origin = "http://127.0.0.1:4318";
const app = process.env.BIM_APP_URL ?? "http://localhost:3100";
const fixture = await readFile("apps/api/tests/fixtures/test_drawing_dxf/01_simple_rooms_mm.dxf", "utf8");
const expires = Math.floor(Date.now() / 1000) + 3600;
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "test@example.invalid" };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...user, sub: user.id, exp: expires, iat: expires - 3600 })}.local-test-signature`;
const session = { access_token: token, refresh_token: "local-test-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
const states = new Map();
const calls = [];
let revision = 0;
let failure = null;
const expiredRevisions = new Set();
let detailDelay = 0;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  response.setHeader("Access-Control-Allow-Origin", app);
  response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, x-client-info, content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  const json = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  if (url.pathname === "/auth/v1/user") { json(user); return; }
  if (url.pathname.startsWith("/signed-upload/")) {
    assert.equal(request.method, "PUT");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    states.get(url.pathname.split("/")[2]).file = Buffer.concat(chunks);
    calls.push({ path: url.pathname, method: request.method });
    json({}); return;
  }
  if (url.pathname.startsWith("/file/")) {
    calls.push({ path: url.pathname, revision: url.searchParams.get("revision"), auth: !!request.headers.authorization });
    if (failure === "file") { response.writeHead(403).end(); return; }
    if (failure === "expired-file") expiredRevisions.add(url.searchParams.get("revision"));
    if (expiredRevisions.has(url.searchParams.get("revision"))) { response.writeHead(403).end(); return; }
    response.writeHead(200, { "Content-Type": "application/dxf" });
    response.end(states.get(url.pathname.split("/")[2])?.file ?? fixture); return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) { json({}, 401); return; }
  calls.push({ path: url.pathname, method: request.method });
  // Exact wire format of BIM-47; no synthetic jobs/results in this HTTP adapter.
  if (!url.pathname.startsWith("/api/v1/drawings")) { json({}, 404); return; }
  const segments = url.pathname.split("/");
  const id = segments[4];
  if (detailDelay) await new Promise(resolve => setTimeout(resolve, detailDelay));
  if (failure === "network") { request.socket.destroy(); return; }
  if (typeof failure === "number") { json({}, failure); return; }
  if (url.pathname === "/api/v1/drawings" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const drawing = { id: "uploaded-from-bim62", owner_id: user.id, original_file_name: input.original_file_name,
      storage_path: `test/${input.original_file_name}`, units: input.units, status: "uploaded", created_at: "2026-10-29T00:00:00Z" };
    states.set(drawing.id, drawing);
    json({ drawing, upload: { url: `${origin}/signed-upload/${drawing.id}`, path: drawing.storage_path, expires_in_seconds: 3600 } }); return;
  }
  if (!id) { json({}, 404); return; }
  if (!states.has(id)) states.set(id, { id, owner_id: user.id, original_file_name: `${id}.dxf`, storage_path: `test/${id}.dxf`,
    status: id === "failed" ? "failed" : id === "processing" ? "processing" : "uploaded", units: "from_file", created_at: "2026-10-29T00:00:00Z" });
  const state = states.get(id);
  if (request.method === "POST" && segments[5] === "process") {
    setTimeout(() => json({ drawing_id: id, status: "accepted", message: "Processing stub accepted. BIM-54/BIM-55/BIM-57 will be connected later." }), 300); return;
  }
  const link = `${origin}/file/${id}?revision=${id === "same-link" ? 0 : ++revision}`;
  json({ id: state.id, owner_id: state.owner_id, original_file_name: state.original_file_name, storage_path: state.storage_path,
    units: state.units, status: state.status, created_at: state.created_at,
    source_download_url: failure === "missing" ? null : link,
    source_download_url_expires_at: new Date(Date.now() + (failure === "expired" ? -1000 : 3600000)).toISOString() });
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
  check("from_file units stay unresolved", await evaluate(body("очікується визначення з файла")));
  check("result download is disabled with an explanation", await evaluate("Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim()==='Завантажити DXF результату' && b.disabled) && !!document.querySelector('#result-download-help')"));
  await evaluate("window.__canvas = document.querySelector('canvas')");
  await evaluate("const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Обробити'); b.click(); b.click()");
  await until(body("Обробку не запущено, результат не створено"));
  await delay(300);
  const afterAccepted = calls.length;
  await delay(4300);
  check("accepted does not start polling or fabricate a result", calls.length === afterAccepted && await evaluate(`${body("Статус: Готове до обробки")} && !document.querySelector('[data-room-id]') && !document.querySelector('[data-device-id]')`));
  check("duplicate clicks send one POST", calls.filter(call => call.path === "/api/v1/drawings/first/process").length === 1);
  const loads = calls.filter(call => call.path.startsWith("/file/")).length;
  await click("Оновити стан"); await delay(300);
  check("metadata refresh retains the source canvas", calls.filter(call => call.path.startsWith("/file/")).length === loads && await evaluate("window.__canvas === document.querySelector('canvas')"));
  await screenshot("source-desktop");
  await evaluate("window.__saved = []; HTMLAnchorElement.prototype.click = function(){window.__saved.push(this.download)}");
  const beforeDownload = calls.length;
  await click("Завантажити оригінальний DXF"); await until(body("DXF передано браузеру"));
  const downloadCalls = calls.slice(beforeDownload);
  check("download refreshes GET before fetching the source without bearer credentials", downloadCalls[0].path === "/api/v1/drawings/first" && downloadCalls[1].path === "/file/first" && !downloadCalls[1].auth);
  check("source filename is not relabeled as processed", await evaluate("window.__saved[0] === 'first.dxf'"));
  for (const [mode, message] of [["expired", "Термін дії"], ["missing", "Посилання на цей DXF ще недоступне"], ["file", "Посилання відхилено"]]) {
    failure = mode; await click("Завантажити оригінальний DXF"); await until(body(message)); check(`download reports ${mode}`);
  }
  failure = null;
  failure = "expired-file"; await navigate("/drawings/retry-expired");
  await until(body("Не вдалося відкрити DXF"));
  const rejectedRevision = calls.at(-1).revision;
  failure = null; detailDelay = 300;
  const beforeRetry = calls.length;
  await evaluate("const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Спробувати знову'); b.click(); b.click()");
  await until(body("Оновлення посилання…"));
  check("remote retry is disabled while refreshing metadata", await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Оновлення посилання…' && b.disabled)"));
  await ready(); detailDelay = 0;
  const retried = calls.slice(beforeRetry);
  check("expired viewer retry performs one fresh GET before loading a new signed URL", retried.length === 2 && retried[0].path === "/api/v1/drawings/retry-expired" && retried[1].path === "/file/retry-expired" && retried[1].revision !== rejectedRevision);
  for (const [mode, message] of [["missing", "Файл для перегляду недоступний"], [401, "Сеанс завершився"], [403, "немає доступу"], [404, "не знайдено"], ["network", "Перевірте з’єднання"]]) {
    failure = "file"; await navigate(`/drawings/retry-${mode}`); await until(body("Не вдалося відкрити DXF"));
    failure = mode;
    await click("Спробувати знову"); await until(body(message));
    const settled = calls.length; await delay(500);
    check(`remote retry handles ${mode} without stale canvas or request loop`, calls.length === settled && !await evaluate("!!document.querySelector('canvas')"));
    failure = null;
    await click(mode === "missing" ? "Оновити файл" : "Спробувати знову"); await ready();
    check(`remote retry recovers after ${mode}`);
  }
  await navigate("/drawings/same-link"); await ready();
  await evaluate("window.__lostCanvas=document.querySelector('canvas'); window.__lostCanvas.dispatchEvent(new Event('webglcontextlost',{bubbles:true,cancelable:true}))");
  await until(body("Втрачено WebGL-контекст"));
  await click("Спробувати знову"); await ready();
  check("retry remounts even when refreshed signed URL is unchanged", await evaluate("window.__lostCanvas !== document.querySelector('canvas')"));
  await navigate("/drawings/first"); await ready();
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(300);
  check("mobile layout fits viewport", await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await screenshot("source-mobile");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.next.router.push('/drawings/second')");
  await until("location.pathname === '/drawings/second'"); await until(body("second.dxf")); await ready();
  check("client navigation clears previous drawing state", !await evaluate(body("Обробку не запущено, результат не створено")));
  await navigate("/drawings/first"); await ready();
  check("reopening source drawing works without mock results", !await evaluate("!!document.querySelector('[data-room-id]')"));
  for (const [status, message] of [[401, "Сеанс завершився"], [403, "немає доступу"], [404, "не знайдено"], ["network", "Перевірте з’єднання"]]) {
    failure = status; await navigate(`/drawings/error-${status}`); await until(body(message));
    failure = null; await click("Спробувати знову"); await ready(); check(`GET ${status} recovers through user retry`);
  }
  failure = "missing"; await navigate("/drawings/missing"); await until(body("Файл для перегляду недоступний"));
  check("missing source URL has an explicit empty state", true);
  failure = null; await click("Оновити файл"); await ready();
  await navigate("/drawings/failed"); await ready();
  check("FastAPI failed status is displayed correctly", await evaluate(body("Статус: Помилка обробки")));
  await navigate("/drawings/processing"); await ready();
  const whileProcessing = calls.length; await delay(2300);
  check("no automatic polling without a jobs capability", calls.length === whileProcessing);
  await navigate("/upload"); await until("!!document.querySelector('input[type=file]')");
  const { root } = await cdp("DOM.getDocument");
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [fileURLToPath(new URL("../../api/tests/fixtures/test_drawing_dxf/01_simple_rooms_mm.dxf", import.meta.url))] });
  await evaluate("document.querySelector('form').requestSubmit()");
  await until("location.pathname === '/drawings/uploaded-from-bim62'"); await ready();
  check("BIM-62 upload navigates to BIM-63 and renders the uploaded source", await evaluate(body("01_simple_rooms_mm.dxf")) && states.get("uploaded-from-bim62").file.length > 0);
  check("all drawing requests share /api/v1 and no job endpoint is requested", calls.filter(c=>c.path.includes('drawings')).every(c=>c.path.startsWith('/api/v1/drawings')) && !calls.some(c=>c.path.includes('processing-jobs')));
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
  await writeFile(`${output}/results.json`, JSON.stringify({ results, exceptions, scope: "Local HTTP fixture matching BIM-47 snake_case/accepted and test auth; no live Supabase acceptance claimed." }, null, 2));
  socket.close(); server.closeAllConnections(); server.close();
}
