/* eslint-disable */
/**
 * One-off README screenshot capture (run: node scripts/capture-screenshots.mjs).
 * Drives the REAL app (Vite 5173 + API 8787) through its actual flows and
 * screenshots them — no mock data, so shots stay honest to the product.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.APP_URL ?? "http://localhost:5173";
const OUT = path.resolve("docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900", "--force-device-scale-factor=2"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(ms = 900) {
  await sleep(ms);
  await page.evaluate(() => new Promise((res) => setTimeout(res, 250)));
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
}

async function goto(hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await settle(1100);
}

// ---------- 1. Home (light) ----------
await page.goto(`${BASE}/#/`, { waitUntil: "networkidle2" });
await settle(1400);
await page.evaluate(() => localStorage.setItem("ponder.theme", "light"));
await page.reload({ waitUntil: "networkidle2" });
await settle(1600);
await shot("home-light");

// ---------- 2. Home (dark) ----------
await page.evaluate(() => localStorage.setItem("ponder.theme", "dark"));
await page.reload({ waitUntil: "networkidle2" });
await settle(1600);
await shot("home-dark");

// ---------- 3. Canvas with a real explored graph (light) ----------
const canvases = await page.evaluate(() => fetch("/api/canvases").then((r) => r.json()));
if (!canvases.length) {
  console.error("No canvases exist — ask a question in the app first, then re-run.");
  process.exit(1);
}
const canvasId = canvases[0].id;
await page.evaluate((id) => localStorage.setItem("ponder.theme", "light"));
await page.goto(`${BASE}/#/canvas/${canvasId}`, { waitUntil: "networkidle2" });
await settle(2600);
await page.evaluate(() => document.querySelector('[data-page="home"], main')?.scrollTo?.(0, 0));
await shot("canvas-light");

// ---------- 4. Canvas (dark) ----------
await page.evaluate(() => localStorage.setItem("ponder.theme", "dark"));
await settle(600);
await shot("canvas-dark");

// ---------- 5. Knowledge Graph page ----------
await page.evaluate(() => {
  location.hash = "#/graph";
});
await settle(1800);
await shot("knowledge-graph");

// ---------- 6. Library ----------
await page.evaluate(() => {
  location.hash = "#/library";
});
await settle(1500);
await shot("library");

// ---------- 7. Review ----------
await page.evaluate(() => {
  location.hash = "#/review";
});
await settle(1500);
await shot("review");

await browser.close();
console.log("done →", OUT);
