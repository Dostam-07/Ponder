/** Real-app screenshots and desktop/mobile UI smoke checks, using Node's WebSocket
 * and Chrome's DevTools protocol. Run with the dev servers already running.
 * An isolated browser profile keeps your browser preferences separate.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const CHROME = process.env.CHROME_PATH ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((file) => fs.existsSync(file));
if (!CHROME) throw new Error("Set CHROME_PATH to your Chrome or Edge executable.");
const BASE = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const HISTORY_ONLY = process.argv.includes("--history-only");
const TERMS_ONLY = process.argv.includes("--terms-only");
const PICTURE_ERRORS_ONLY = process.argv.includes("--picture-errors-only");
const OUT = path.resolve("docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync("build", { recursive: true });
const profile = fs.mkdtempSync(path.resolve("build", "ui-capture-"));
const browser = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const exited = new Promise((resolve) => { browser.once("exit", resolve); browser.once("error", resolve); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
const pending = new Map();
const pageErrors = [];
let sequence = 0;
let session;
let emptyHistory = false;
const historyMutations = [];
let historyFixture;
let confirmHistoryDelete = false;
let pictureFixture;
let termGraph;
const termRequests = [];
const termVisualRequests = [];

function command(method, params = {}, sessionId = session) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression) {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      if (!/execution context was destroyed|cannot find.*context/i.test(error.message)) throw error;
    }
    await sleep(100);
  }
  throw new Error(`UI did not become ready: ${expression}`);
}

async function click(selector) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) throw new Error('Control unavailable: ' + ${JSON.stringify(selector)});
    element.click();
  })()`);
  await sleep(150);
}

async function fill(selector, value) {
  await evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(150);
}

async function goto(route, selector = "main h1") {
  await evaluate(`location.hash = ${JSON.stringify(`#/${route}`)}`);
  await waitFor(`location.hash === ${JSON.stringify(`#/${route}`)} && !!document.querySelector(${JSON.stringify(selector)})`);
  await sleep(1000);
}

async function reloadReady(expression) {
  const previousOrigin = await evaluate("performance.timeOrigin");
  await command("Page.reload");
  await waitFor(`performance.timeOrigin !== ${previousOrigin} && (${expression})`);
}

async function theme(value) {
  if ((await evaluate('document.documentElement.classList.contains("light")')) !== (value === "light")) {
    await click(`button[aria-label="Switch to ${value} theme"]`);
  }
  await waitFor(`localStorage.getItem("ponder.theme") === ${JSON.stringify(value)}`);
}

async function viewport(width, height) {
  await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(250);
}

async function noOverflow(label) {
  const overflow = await evaluate(`Array.from(document.querySelectorAll('html, main, [data-page]'))
    .filter(el => el.scrollWidth > el.clientWidth + 2).map(el => ({
      element: el.getAttribute('data-page') || el.tagName, width: el.clientWidth, scroll: el.scrollWidth
    }))`);
  assert.deepEqual(overflow, [], `${label}: horizontal overflow`);
}

async function shot(name) {
  if (TERMS_ONLY || PICTURE_ERRORS_ONLY) return;
  if (HISTORY_ONLY && !["canvas-history", "canvas-history-list"].includes(name)) return;
  const { data } = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("saved", name);
}

async function checkPictureCreditError() {
  const canvases = await evaluate('fetch("/api/canvases").then(r => r.json())');
  const canvas = canvases.find((item) => item.node_count > 0);
  if (!canvas) throw new Error("Explore a question first to check the picture failure state.");
  const original = await evaluate(`fetch('/api/canvases/${canvas.id}/graph').then(r => r.json())`);
  const node = { ...original.nodes[0], parent_id: null, position: { x: 0, y: 0 }, collapsed: false, width: 420, status: "complete", title: "Water cycle", answer_text: "The water cycle moves water between the surface and the atmosphere through evaporation and condensation.", sections: [], gaps: [], visual: null };
  pictureFixture = { graph: { ...original, nodes: [node], links: [], path: null, map: null }, requests: [] };
  await command("Fetch.enable", { patterns: [
    { urlPattern: `*/api/canvases/${canvas.id}/graph`, requestStage: "Request" },
    { urlPattern: "*/api/visual", requestStage: "Request" },
  ] });
  await viewport(1440, 1000);
  await goto(`canvas/${canvas.id}`, `[data-node-id="${node.id}"]`);
  await click(`[data-node-id="${node.id}"] button[title^="Generate an educational picture"]`);
  await waitFor('!!document.querySelector(\'[data-visual-error="credits_required"]\')');
  const message = await evaluate('document.querySelector(\'[data-visual-error="credits_required"]\').textContent');
  assert.ok(message.includes("Picture generation needs OpenRouter credits"));
  assert.ok(message.includes("Retry picture"));
  assert.ok(!message.includes("HTTP 402") && !message.includes("metadata"), "Billing failures should not display raw JSON");
  assert.equal(await evaluate('document.querySelector(\'[data-visual-error] a[target="_blank"]\').href'), "https://openrouter.ai/settings/credits");
  assert.equal(await evaluate('document.querySelector(\'[data-visual-error] a[href="#/settings"]\') !== null'), true);
  assert.equal(pictureFixture.requests.length, 1);
  await sleep(750);
  assert.equal(pictureFixture.requests.length, 1, "Credit errors must not automatically repeat billable requests");
  const failure = { message: "This OpenRouter account or API key has insufficient credits for picture generation.", code: "credits_required" };
  node.visual = { type: "image", status: "failed", spec: null, error: failure };
  await reloadReady('!!document.querySelector(\'[data-visual-error="credits_required"]\')');
  await click('[data-visual-error] button');
  await waitFor('!!document.querySelector(\'[data-visual-error="credits_required"]\')');
  assert.equal(pictureFixture.requests.length, 2, "Retry picture should issue one explicit request");
  assert.ok(pictureFixture.requests.every((request) => request.kind === "picture"));
  await viewport(390, 844);
  await reloadReady('!!document.querySelector(\'[data-visual-error="credits_required"]\')');
  await noOverflow("Picture credit error mobile");
  await click('[data-visual-error] a[href="#/settings"]');
  await waitFor('location.hash === "#/settings" && !!document.querySelector("#openrouter-api-key")');
  pictureFixture = undefined;
  await command("Fetch.disable");
  const after = await evaluate(`fetch('/api/canvases/${canvas.id}/graph').then(r => r.json())`);
  assert.deepEqual(after.nodes, original.nodes, "Picture error fixtures must not change saved answers");
  console.log("Picture credit guidance, billing/settings links, persisted failure, explicit retry, and mobile layout passed (isolated browser fixtures)");
}

async function checkInlineTerms() {
  const canvases = await evaluate('fetch("/api/canvases").then(r => r.json())');
  const canvas = canvases.find((entry) => entry.node_count > 0);
  if (!canvas) throw new Error("Explore a question first to run the inline-term browser check.");
  const original = await evaluate(`fetch('/api/canvases/${canvas.id}/graph').then(r => r.json())`);
  const answer = "Rayleigh scattering redirects light in the atmosphere. A shorter wavelength scatters more strongly than a longer wavelength, helping explain the blue sky.";
  const source = {
    ...original.nodes[0], parent_id: null, position: { x: 0, y: 0 }, width: 420, collapsed: false,
    status: "complete", answer_text: answer, key_terms: ["Rayleigh scattering", "wavelength"],
    sections: [{ heading: "How it works", body: answer }], visual: null, gaps: [], provenance: null,
    material_id: "77777777-7777-4777-8777-777777777777", mode: "socratic",
  };
  // Fixtures and SSE responses exist only in this isolated browser. Ask/visual
  // interception keeps the check independent of model credits and workspace writes.
  termGraph = { ...original, nodes: [source], links: [], path: null, map: null };
  await command("Fetch.enable", { patterns: [
    { urlPattern: `*/api/canvases/${canvas.id}/graph`, requestStage: "Request" },
    { urlPattern: "*/api/nodes/ask", requestStage: "Request" },
    { urlPattern: "*/api/visual", requestStage: "Request" },
  ] });
  await viewport(1440, 1000);
  await goto(`canvas/${canvas.id}`, "[data-explain-term]");
  const selector = `[data-node-id="${source.id}"] button[data-explain-term="Rayleigh scattering"]`;
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
  for (const value of ["light", "dark"]) {
    await theme(value);
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`), "rgba(0, 0, 0, 0)", "Concept highlights should be visible in both themes");
  }
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
  await waitFor('!!document.querySelector(\'[data-node-id="88888888-8888-4888-8888-888888888888"]\')');
  assert.equal(termRequests.length, 1);
  assert.equal(termRequests[0].canvas_id, canvas.id);
  assert.equal(termRequests[0].parent_id, source.id);
  assert.equal(termRequests[0].branch_origin, "term_chip");
  assert.equal(termRequests[0].question, "Explain Rayleigh scattering");
  assert.equal(termRequests[0].mode, "explain");
  assert.equal(termRequests[0].material_id, source.material_id);
  assert.equal(termRequests[0].context_text, answer);
  assert.equal(termRequests[0].visual_requested, undefined);
  await click('button[title="Zoom out"]');
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
  await sleep(500);
  await click(selector);
  await sleep(500);
  assert.equal(termRequests.length, 1, "A repeated term click should reuse its explanation");
  assert.equal(await evaluate("document.querySelectorAll('[data-node-id]').length"), 2);
  assert.deepEqual(termVisualRequests, [], "A term click should only generate an explanation");
  termGraph = undefined;
  await command("Fetch.disable");
  await reloadReady(`!!document.querySelector('[data-canvas="${canvas.id}"]') && !document.querySelector('[data-node-id="88888888-8888-4888-8888-888888888888"]')`);
  const after = await evaluate(`fetch('/api/canvases/${canvas.id}/graph').then(r => r.json())`);
  assert.deepEqual(after.nodes.map((node) => node.id), original.nodes.map((node) => node.id));
  console.log("Inline highlights, keyboard explanation, parent/source context, repeat-click reuse, and click-only visuals passed (isolated browser fixtures)");
}

async function handlePausedRequest({ requestId, request }) {
  let body;
  let contentType = "application/json";
  let responseCode = 200;
  if (pictureFixture) {
    if (request.url.endsWith("/graph")) body = JSON.stringify(pictureFixture.graph);
    else {
      pictureFixture.requests.push(JSON.parse(request.postData));
      responseCode = 402;
      body = JSON.stringify({ code: "credits_required", error: "This OpenRouter account or API key has insufficient credits for picture generation." });
    }
  } else if (historyFixture) {
    const id = new URL(request.url).pathname.split("/").pop();
    const canvas = historyFixture.canvases.find((item) => item.id === id);
    if (request.method === "GET" && id === "canvases") body = JSON.stringify(historyFixture.canvases);
    else if (request.method === "PATCH" && canvas) {
      historyFixture.mutations.push("rename");
      if (historyFixture.rejectRename) { responseCode = 503; body = '{"error":"Rename failed; please retry."}'; }
      else {
        canvas.title = JSON.parse(request.postData).title;
        canvas.updated_at = Date.now();
        // The real PATCH response omits the list-only node_count field.
        const { node_count, ...saved } = canvas;
        body = JSON.stringify(saved);
      }
    } else if (request.method === "DELETE" && canvas) {
      historyFixture.mutations.push("delete");
      if (historyFixture.rejectDelete) { responseCode = 503; body = '{"error":"Delete failed; please retry."}'; }
      else { historyFixture.canvases = historyFixture.canvases.filter((item) => item.id !== id); responseCode = 204; body = ""; }
    } else { responseCode = 503; body = '{"error":"Unexpected history request"}'; }
  } else if (termGraph) {
    if (request.url.endsWith("/graph")) body = JSON.stringify(termGraph);
    else if (request.url.endsWith("/api/nodes/ask")) {
      const ask = JSON.parse(request.postData);
      termRequests.push(ask);
      const child = { ...termGraph.nodes[0], id: "88888888-8888-4888-8888-888888888888", parent_id: ask.parent_id, branch_origin: ask.branch_origin, question: ask.question, position: ask.position, title: "Rayleigh scattering", answer_text: "Rayleigh scattering redirects light when it interacts with particles much smaller than its wavelength.", sections: [], mode: ask.mode, key_terms: ["wavelength"] };
      const events = [
        { type: "node_created", node: { ...child, status: "answering", answer_text: "" } },
        { type: "delta", node_id: child.id, text: child.answer_text },
        { type: "stage2", node_id: child.id, title: child.title, followups: [], tags: [], key_terms: child.key_terms },
        { type: "done", node_id: child.id, node: child },
      ];
      body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      contentType = "text/event-stream";
    } else {
      termVisualRequests.push(request.url);
      body = '{"error":"Unexpected visual generation"}';
      responseCode = 503;
    }
  } else if (request.method !== "GET" || emptyHistory) {
    const mutation = request.method !== "GET";
    if (mutation) historyMutations.push(request.method);
    responseCode = mutation ? 503 : 200;
    body = mutation ? '{"error":"Unexpected history write"}' : "[]";
  }
  if (body !== undefined) {
    await command("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: contentType }], body: Buffer.from(body).toString("base64") });
  } else await command("Fetch.continueRequest", { requestId });
}

async function checkCanvasHistory() {
  await command("Fetch.enable", { patterns: [{ urlPattern: "*/api/canvases", requestStage: "Request" }] });
  const before = await evaluate('fetch("/api/canvases").then(r => r.json())');
  await viewport(1440, 1000);
  await click('nav[aria-label="Primary"] button[title="Canvas"]');
  await waitFor('location.hash === "#/canvases" && !!document.querySelector(\'[data-page="canvases"]\')');
  await waitFor(`document.querySelectorAll('[data-history-canvas]').length === ${before.length}`);
  assert.equal(await evaluate(`document.querySelector('nav[aria-label="Primary"] button[title="Canvas"]').getAttribute('aria-current')`), "page");
  await noOverflow("Canvas history desktop");

  const selected = before[1] ?? before[0];
  if (selected) {
    await click(`[data-history-canvas="${selected.id}"] [data-history-open]`);
    await waitFor(`location.hash === ${JSON.stringify(`#/canvas/${selected.id}`)} && !!document.querySelector('[data-canvas="${selected.id}"]')`);
    await click('nav[aria-label="Primary"] button[title="Canvas"]');
    await waitFor('location.hash === "#/canvases" && !!document.querySelector(\'[data-page="canvases"]\')');
    await evaluate('document.querySelector(\'[aria-label="Search canvas history"]\').focus()');
    await command("Input.insertText", { text: "__ponder_no_matching_canvas__" });
    await waitFor('document.querySelector("main").textContent.includes("No matching canvases")');
    assert.equal(await evaluate("document.querySelectorAll('[data-history-canvas]').length"), 0);
    await evaluate(`(() => {
      const field = document.querySelector('[aria-label="Search canvas history"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.blur();
    })()`);
    await waitFor(`document.querySelectorAll('[data-history-canvas]').length === ${before.length}`);
  }
  await click('button[aria-label="Grid view"]');
  await noOverflow("History grid desktop");
  await shot("canvas-history");
  await click('button[aria-label="List view"]');
  await noOverflow("History list desktop");
  await shot("canvas-history-list");
  await reloadReady('!!document.querySelector(\'[data-history-view="list"]\')');
  assert.equal(await evaluate('localStorage.getItem("ponder.canvas-history-view")'), "list");
  await viewport(390, 844);
  await noOverflow("History list mobile");
  await click('button[aria-label="Grid view"]');
  await noOverflow("History grid mobile");
  await click('button[aria-label="Open navigation menu"]');
  await click('nav[aria-label="Primary"] button[title="Canvas"]');
  await waitFor(`!document.querySelector('button[aria-label="Close menu"]') && location.hash === '#/canvases'`);
  if (selected) {
    await click(`[data-history-canvas="${selected.id}"] a[aria-label^="Edit canvas"]`);
    await waitFor(`!!document.querySelector('[data-canvas="${selected.id}"] nav[aria-label="Canvas location"] a')`);
    await click('nav[aria-label="Canvas location"] a');
    await waitFor('location.hash === "#/canvases" && !!document.querySelector(\'[data-page="canvases"]\')');
  }

  // Empty-history regression: intercept list reads and block any unexpected
  // writes, so the check never creates or deletes data in the running workspace.
  await goto("", '[data-page="home"]');
  emptyHistory = true;
  await reloadReady('!!document.querySelector("main textarea:not(:disabled)")');
  await click('button[aria-label="Open navigation menu"]');
  await click('nav[aria-label="Primary"] button[title="Canvas"]');
  await waitFor('location.hash === "#/canvases" && document.querySelector("main").textContent.includes("Your canvas history starts here")');
  assert.deepEqual(historyMutations, [], "Opening history must not create a canvas");
  emptyHistory = false;
  await command("Fetch.disable");
  await reloadReady(`location.hash === '#/canvases' && !!document.querySelector('[data-page="canvases"]') && document.querySelectorAll('[data-history-canvas]').length === ${before.length}`);
  const after = await evaluate('fetch("/api/canvases").then(r => r.json())');
  assert.deepEqual(after.map((canvas) => canvas.id), before.map((canvas) => canvas.id), "History navigation should leave saved canvases intact");
  console.log("Canvas history grid/list, saved view preference, edit navigation, search, mobile, breadcrumb, refresh, and empty history passed");
}

async function checkHistoryActions() {
  const before = await evaluate('fetch("/api/canvases").then(r => r.json())');
  const id = "99999999-9999-4999-8999-999999999999";
  const initial = { id, title: "History action check", node_count: 12, created_at: Date.now(), updated_at: Date.now() };
  historyFixture = { canvases: [initial], mutations: [], rejectRename: false, rejectDelete: false };
  await command("Fetch.enable", { patterns: [
    { urlPattern: "*/api/canvases", requestStage: "Request" },
    { urlPattern: "*/api/canvases/*", requestStage: "Request" },
  ] });
  await goto("canvases", '[data-page="canvases"]');
  await reloadReady(`!!document.querySelector('[data-history-canvas="${id}"]')`);
  const row = `[data-history-canvas="${id}"]`;
  for (const view of ["grid", "list"]) {
    await viewport(view === "grid" ? 1440 : 390, view === "grid" ? 1000 : 844);
    await click(`button[aria-label="${view === "grid" ? "Grid" : "List"} view"]`);
    await click(`${row} button[aria-label^="Rename canvas"]`);
    await fill(`${row} input`, "   ");
    assert.equal(await evaluate(`document.querySelector('${row} button[type="submit"]').disabled`), true, "Blank titles must not save");
    await evaluate(`document.querySelector('${row} input').focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await waitFor(`!document.querySelector('${row} input')`);
    const countBefore = historyFixture.mutations.length;
    await click(`${row} button[aria-label^="Delete canvas"]`);
    assert.equal(historyFixture.mutations.length, countBefore, "Cancelling deletion must leave the canvas intact");
    await click(`${row} button[aria-label^="Rename canvas"]`);
    const title = `Renamed ${view} exploration`;
    await fill(`${row} input`, title);
    await evaluate(`document.querySelector('${row} input').focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r" });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
    await waitFor(`document.querySelector('${row} h2')?.textContent === ${JSON.stringify(title)}`);
    assert.equal(await evaluate("location.hash"), "#/canvases", "Renaming must not open the board");
    assert.ok(await evaluate(`document.querySelector('${row}').textContent.includes('12 answers')`), "Renaming preserves answer counts");
    await reloadReady(`document.querySelector('${row} h2')?.textContent === ${JSON.stringify(title)}`);
    assert.ok(await evaluate(`document.querySelector('[data-history-view="${view}"]') !== null`), "View choice survives refresh");
    await noOverflow(`History ${view} action controls`);
    historyFixture.rejectRename = true;
    await click(`${row} button[aria-label^="Rename canvas"]`);
    await fill(`${row} input`, "Rejected title");
    await click(`${row} button[type="submit"]`);
    await waitFor('document.querySelector("main [role=alert]")?.textContent.includes("Rename failed")');
    assert.equal(historyFixture.canvases[0].title, title);
    await click(`${row} form button[type="button"]`);
    historyFixture.rejectRename = false;
  }
  confirmHistoryDelete = true;
  historyFixture.rejectDelete = true;
  await click(`${row} button[aria-label^="Delete canvas"]`);
  await waitFor('document.querySelector("main [role=alert]")?.textContent.includes("Delete failed")');
  assert.ok(await evaluate(`!!document.querySelector('${row}')`), "Failed deletion must keep the canvas visible");
  historyFixture.rejectDelete = false;
  await click(`${row} button[aria-label^="Delete canvas"]`);
  await waitFor(`!document.querySelector('${row}') && document.querySelector('main').textContent.includes('Your canvas history starts here')`);
  historyFixture = undefined;
  confirmHistoryDelete = false;
  await command("Fetch.disable");
  await reloadReady(`document.querySelectorAll('[data-history-canvas]').length === ${before.length}`);
  const after = await evaluate('fetch("/api/canvases").then(r => r.json())');
  assert.deepEqual(after, before, "History action fixtures must not change the saved workspace");
  console.log("Inline rename, Enter/Escape, blank titles, delete confirmation/cancel, and failure handling passed (isolated browser fixtures)");
}

try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not expose DevTools")), 20_000);
    browser.once("error", (error) => { clearTimeout(timer); reject(error); });
    browser.once("exit", () => { clearTimeout(timer); reject(new Error(`Chrome exited during startup: ${stderr}`)); });
    browser.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      void handlePausedRequest(message.params).catch((error) => pageErrors.push(error.message));
    }
    if (message.method === "Page.javascriptDialogOpening") {
      void command("Page.handleJavaScriptDialog", { accept: confirmHistoryDelete }).catch((error) => pageErrors.push(error.message));
    }
  });
  socket.addEventListener("close", () => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error("Chrome disconnected")); }
    pending.clear();
  });
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  session = (await command("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await command("Runtime.enable");
  await command("Page.enable");
  await viewport(1440, 1000);
  await command("Page.navigate", { url: `${BASE}/#/` });
  await waitFor('!!document.querySelector("main textarea:not(:disabled)")');

  if (PICTURE_ERRORS_ONLY) await checkPictureCreditError();
  else if (TERMS_ONLY) await checkInlineTerms();
  else {
    await checkCanvasHistory();
    await checkHistoryActions();
    if (!HISTORY_ONLY) { await checkInlineTerms(); await checkPictureCreditError(); await captureWorkspace(); }
  }
  assert.deepEqual(pageErrors, [], "Uncaught browser errors");
  console.log("Browser checks passed →", OUT);
} finally {
  if (socket?.readyState === WebSocket.OPEN) await command("Browser.close", {}, null).catch(() => {});
  socket?.close();
  await Promise.race([exited, sleep(3000)]);
  if (browser.exitCode === null) browser.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function captureWorkspace() {
  await viewport(1440, 1000);
  await goto("", '[data-page="home"]');

  await evaluate('document.querySelector("main textarea").focus()');
  await command("Input.insertText", { text: "UI verification" });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", modifiers: 8 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", modifiers: 8 });
  await waitFor('document.querySelector("main textarea")?.value.includes("\\n")');
  assert.equal(await evaluate("location.hash"), "#/", "Shift+Enter should keep the draft on Home");
  await evaluate(`(() => {
    const field = document.querySelector('main textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.blur();
  })()`);

  for (const value of ["light", "dark"]) {
    await theme(value);
    await noOverflow(`Home ${value}`);
    await shot(`home-${value}`);
  }
  await goto("settings", '[data-page="settings"]');
  await waitFor('!!document.querySelector("#openrouter-api-key:not(:disabled)")');
  assert.equal(await evaluate('document.querySelector("#openrouter-api-key").type'), "password");
  assert.equal(await evaluate('document.querySelector("#openrouter-api-key").value'), "");
  await click('button[aria-label="Show API key"]');
  assert.equal(await evaluate('document.querySelector("#openrouter-api-key").type'), "text");
  await click('button[aria-label="Hide API key"]');
  for (const value of ["dark", "light"]) {
    await theme(value);
    await noOverflow(`Settings ${value}`);
    await shot(`settings-${value}`);
  }
  for (const section of ["appearance", "voice", "data"]) {
    await click(`#settings-tab-${section}`);
    await waitFor(`!!document.querySelector("#settings-panel-${section}")`);
    await noOverflow(`Settings ${section}`);
    if (section === "appearance") {
      assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".theme-preview-light")).backgroundColor'), await evaluate('getComputedStyle(document.querySelector(".theme-preview-dark")).backgroundColor'), "Theme previews should be distinct");
      await evaluate('document.querySelector(\'[aria-label="Theme"] [aria-checked="true"]\').focus()');
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
      await waitFor('localStorage.getItem("ponder.theme") === "dark"');
      await theme("light");
      await shot("settings-appearance");
    }
  }
  await evaluate('document.querySelector("#settings-tab-data").focus()');
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home" });
  await waitFor('!!document.querySelector("#settings-panel-connections")');

  await viewport(390, 844);
  await noOverflow("Mobile Settings");
  await shot("settings-mobile");
  for (const section of ["appearance", "voice", "data", "connections"]) {
    await click(`#settings-tab-${section}`);
    await noOverflow(`Mobile Settings ${section}`);
  }
  await click('button[aria-label="Open navigation menu"]');
  await waitFor(`!!document.querySelector('button[aria-label="Close menu"]')`);
  await click('button[aria-label="Close menu"]');
  for (const page of ["home", "library", "explore", "graph", "review"]) {
    await goto(page === "home" ? "" : page, `[data-page="${page}"]`);
    await noOverflow(`Mobile ${page}`);
  }

  await viewport(1440, 1000);
  await theme("dark");
  for (const [route, name] of [["graph", "knowledge-graph"], ["library", "library"], ["review", "review"]]) {
    await goto(route, `[data-page="${route}"]`);
    await shot(name);
  }
  const canvases = await evaluate('fetch("/api/canvases").then(r => { if (!r.ok) throw new Error("Cannot load canvases"); return r.json(); })');
  const explored = canvases.find((canvas) => canvas.node_count > 0);
  if (explored) {
    await goto(`canvas/${explored.id}`, ".react-flow__node");
    await sleep(1500);
    for (const value of ["light", "dark"]) {
      await theme(value);
      await shot(`canvas-${value}`);
    }
  } else console.log("Canvas captures skipped: explore a question first.");
}
