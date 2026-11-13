import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { base, launch, createPage, ready, openScenario, showMap, openDetails, calculate, screenshot, resetCamera, clickMap } from "./design-test-utils.mjs";

const catalog = await (await fetch(base + "/api/catalogs")).json();
const mapData = await (await fetch(base + "/api/map")).json();
const browser = await launch(), errors = [], checks = [];
let page;
try {
  for (const [name, width, height] of [["phone", 390, 844], ["tablet", 820, 1180], ["desktop", 1440, 900]]) {
    page = await createPage(browser, errors, width, height);
    await page.route("**/api/**", async route => {
      await new Promise(resolve => setTimeout(resolve, 1600));
      await route.continue();
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".app-shell").waitFor();
    await screenshot(page, `states-${name}-loading`);
    await ready(page);
    await page.unroute("**/api/**");
    await screenshot(page, `states-${name}-initial`);
    await openScenario(page);
    await screenshot(page, `states-${name}-scenario`);
    await openDetails(page, ".route-editor");
    await page.getByRole("button", { name: "Пример маршрута с парковкой", exact: true }).click();
    await page.getByLabel("Парковка у точки Б", { exact: true }).selectOption("manual");
    const parking = catalog.parkings[0];
    await page.getByLabel("Выбранная парковка", { exact: true }).selectOption(parking.parking_id);
    await openDetails(page, ".parking-editor");
    await page.getByLabel("Найти парковку", { exact: true }).fill(parking.source_id);
    await page.getByLabel(`Занятость ${parking.name}`).fill("75");
    await page.route("**/api/simulate", async route => {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 1300));
      await route.fulfill({ response });
    });
    const pending = page.waitForResponse(response => response.url().endsWith("/api/simulate") && response.request().method() === "POST");
    await page.locator(".calculate-button").click();
    await page.locator(".result-loading").waitFor();
    await page.waitForTimeout(200);
    await screenshot(page, `states-${name}-calculating`);
    const response = await pending;
    assert.equal(response.status(), 200);
    let result = await response.json();
    await page.locator(".result-status").waitFor();
    await page.waitForFunction(() => document.querySelector(".panel-scroll")?.scrollTop === 0);
    assert.equal(result.personal_route.after.parking_included, true);
    await page.waitForTimeout(300);
    await screenshot(page, `states-${name}-result`);
    await page.unroute("**/api/simulate");
    await openScenario(page);
    await page.getByLabel(`Занятость ${parking.name}`).fill("100");
    result = await calculate(page);
    assert.equal(result.personal_route.after.parking_status, "parking_full");
    assert(result.personal_route.after.car_route);
    await page.locator(".personal-parking-warning").scrollIntoViewIfNeeded();
    await screenshot(page, `states-${name}-parking-warning`);
    await showMap(page);
    await resetCamera(page);
    await page.getByRole("button", { name: "Добавить дом", exact: true }).click();
    await clickMap(page, mapData, mapData.center);
    await page.locator(".house-map-editor").waitFor();
    assert.equal(await page.getByLabel("Количество жильцов", { exact: true }).inputValue(), "40");
    await screenshot(page, `states-${name}-house`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push({ profile: name, width, height, states: ["loading", "initial", "scenario", "calculating", "result", "parking-warning", "house"] });
    console.log("OK", name, width, height, "7 состояний");
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile("artifacts/design/states-report.json", JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await screenshot(page, "states-failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
}
