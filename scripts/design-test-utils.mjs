import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const require = createRequire(new URL("../.local/qa/package.json", import.meta.url));
export const { chromium } = require("playwright");
export const base = process.env.TEST_URL || "http://127.0.0.1:3000";
export const launch = () => chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
export async function createPage(browser, errors, width = 1440, height = 900, extras = {}) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: width <= 900, hasTouch: width <= 900, ...extras });
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  page.on("console", message => { if (message.type() === "error" && /hydration|Minified React error/i.test(message.text())) errors.push(message.text()); });
  return page;
}
export async function ready(page) {
  await page.locator(".map-canvas canvas, .svg-map").first().waitFor({ timeout: 60000 });
  await page.locator(".map-loading").waitFor({ state: "hidden", timeout: 45000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".overview-metric strong")].length === 3 && [...document.querySelectorAll(".overview-metric strong")].every(el => el.textContent !== "—"));
}
export async function openScenario(page) {
  if (await page.locator(".mobile-tabbar").isVisible()) {
    await page.locator(".mobile-tabbar").getByRole("button", { name: "Сценарий", exact: true }).click();
    await page.getByRole("button", { name: "Раскрыть панель полностью", exact: true }).click();
  } else await page.getByRole("tab", { name: "Сценарий", exact: true }).click();
  await page.locator(".scenario-content").waitFor({ state: "visible" });
}
export async function openResult(page) {
  if (await page.locator(".mobile-tabbar").isVisible()) {
    await page.locator(".mobile-tabbar").getByRole("button", { name: "Результат", exact: true }).click();
    await page.getByRole("button", { name: "Раскрыть панель полностью", exact: true }).click();
  } else await page.getByRole("tab", { name: "Результат", exact: true }).click();
}
export async function showMap(page) {
  if (await page.locator(".mobile-tabbar").isVisible()) await page.locator(".mobile-tabbar").getByRole("button", { name: "Карта", exact: true }).click();
}
export async function reset(page) { await openScenario(page); await page.getByRole("button", { name: "Сбросить", exact: true }).click(); await ready(page); await page.waitForFunction(() => document.querySelectorAll(".overview-metric strong")[2]?.textContent.replace(/\s/g, "") === "1000"); await page.waitForTimeout(380); }
export async function openDetails(page, selector) { if (!await page.locator(selector).evaluate(el => el.open)) await page.locator(selector + ">summary").click(); }
export async function calculate(page) {
  const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/simulate") && r.request().method() === "POST", { timeout: 30000 });
  await page.locator(".calculate-button").click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  const result = await response.json();
  await page.locator(".result-status").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".panel-scroll")?.scrollTop === 0);
  return result;
}
export async function demo(page) {
  await openScenario(page);
  const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/simulate") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Демо-сценарий/ }).click();
  const response = await responsePromise; assert.equal(response.status(), 200);
  const result = await response.json(); await page.locator(".result-status").waitFor(); await page.waitForFunction(() => document.querySelector(".panel-scroll")?.scrollTop === 0); return result;
}
export async function screenshot(page, name) {
  await mkdir("artifacts/design", { recursive: true });
  await page.locator(".app-toast").waitFor({ state: "hidden", timeout: 6000 }).catch(() => {});
  // Capture the completed native sheet transition, rather than an intermediate frame.
  await page.waitForTimeout(350);
  await page.screenshot({ path: `artifacts/design/${name}.png` });
}
export async function resetCamera(page) { await page.getByRole("button", { name: "Начальный вид карты", exact: true }).click(); await page.waitForTimeout(420); }
export async function clickMap(page, mapData, coordinates) {
  const box = await page.locator(".map-canvas").boundingBox();
  const world = ([lon, lat]) => { const size = 512 * 2 ** 14.8; const sin = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * size, (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size]; };
  const origin = world(mapData.center), position = world(coordinates);
  const x = box.x + box.width / 2 + position[0] - origin[0], y = box.y + box.height / 2 + position[1] - origin[1];
  assert(x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height, "Тестовая точка должна быть видимой");
  await page.mouse.click(x, y);
}
export function nearStreet(mapData, lon, lat) {
  const coordinates = mapData.edges.features.filter(f => f.properties.name === "Океанский проспект").flatMap(f => [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)]);
  return coordinates.reduce((best, point) => Math.hypot((point[0] - lon) * .73, point[1] - lat) < Math.hypot((best[0] - lon) * .73, best[1] - lat) ? point : best);
}
export async function swipe(page, from, to) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 10; i++) { await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 }] }); await page.waitForTimeout(25); }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach(); await page.waitForTimeout(360);
}
