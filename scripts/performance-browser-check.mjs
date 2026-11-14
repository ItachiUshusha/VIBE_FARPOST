import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { base, launch, createPage, ready, openScenario, openDetails, demo } from "./design-test-utils.mjs";

const browser = await launch();
const errors = [], checks = [];
const check = text => { checks.push(text); console.log("OK", text); };
try {
  const page = await createPage(browser, errors, 1280, 800, { deviceScaleFactor: 2, reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.__sourceUpdates = {};
    window.__carFeatureCount = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.type === "LD") {
        const source = message.data?.source || "unknown";
        window.__sourceUpdates[source] = (window.__sourceUpdates[source] || 0) + 1;
        if (source === "cars") window.__carFeatureCount = message.data?.data?.features?.length ?? 0;
      }
      return original.call(this, message, ...rest);
    };
  });
  const catalogs = await (await page.request.get(base + "/api/catalogs")).json();
  await page.goto(base); await page.bringToFront(); await ready(page);
  await page.getByRole("button", { name: "Продолжить анимацию", exact: true }).waitFor();
  await page.waitForTimeout(500);
  const sourceUpdates = () => page.evaluate(() => ({ ...window.__sourceUpdates }));
  const countCars = async () => (await sourceUpdates()).cars || 0;
  const idleStart = await countCars();
  await page.waitForTimeout(1100);
  assert.equal(await countCars(), idleStart);
  const pixels = await page.locator(".map-canvas canvas").evaluate(el => {
    window.__originalMapCanvas = el;
    return { width: el.width, cssWidth: el.clientWidth };
  });
  assert.equal(pixels.width, pixels.cssWidth);
  check("В покое анимация не обновляется; экономный режим использует DPR 1");

  assert.equal(await page.locator(".parking-setting").count(), 0);
  await openScenario(page); await openDetails(page, ".parking-editor"); await page.getByRole("button", { name: "Открыть полный каталог", exact: true }).click();
  await page.locator(".parking-setting").first().waitFor();
  const first = catalogs.parkings[0], last = catalogs.parkings.at(-1);
  const firstRow = page.locator(`[data-parking-id="${first.parking_id}"]`);
  await firstRow.locator("input").fill("73");
  await firstRow.locator("input").focus();
  const viewport = page.locator(".parking-settings");
  await viewport.evaluate(el => { el.scrollTop = 20000; });
  await page.waitForTimeout(250);
  assert.equal(await firstRow.locator("input").evaluate(el => document.activeElement === el), true);
  assert(await page.locator(".parking-setting").count() <= 16);
  await page.getByLabel("Найти парковку", { exact: true }).focus();
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.locator(`[data-parking-id="${last.parking_id}"]`).waitFor();
  assert(await page.locator(".parking-setting").count() <= 16);
  await viewport.evaluate(el => { el.scrollTop = 0; });
  await firstRow.waitFor(); assert.equal(await firstRow.locator("input").inputValue(), "73");
  check("Доступны все парковки; DOM ограничен 16 карточками; фокус и занятость сохраняются при прокрутке");

  const search = page.getByLabel("Найти парковку", { exact: true });
  await search.fill(first.source_id);
  await firstRow.waitFor();
  assert.equal(await firstRow.locator("input").inputValue(), "73");
  await search.fill("__нет_такой_парковки__");
  await page.getByText("По этому запросу парковок нет.", { exact: true }).waitFor();
  await search.fill(""); await firstRow.waitFor();
  await page.locator(".parking-editor > summary").click();
  await page.waitForFunction(() => document.querySelectorAll(".parking-setting").length === 0);
  await openDetails(page, ".parking-editor"); await page.getByRole("button", { name: "Открыть полный каталог", exact: true }).click();
  await firstRow.waitFor(); assert.equal(await firstRow.locator("input").inputValue(), "73");
  check("Поиск, пустая выдача и повторное открытие сохраняют значения; закрытый список размонтирован");

  let previous = await sourceUpdates();
  await page.getByRole("button", { name: /^Дождь/ }).click();
  await page.waitForTimeout(300);
  let current = await sourceUpdates();
  assert.equal(current["new-roads"] || 0, previous["new-roads"] || 0);
  assert.equal(current["road-draft-points"] || 0, previous["road-draft-points"] || 0);
  await openDetails(page, ".housing-editor");
  previous = await sourceUpdates();
  await page.getByLabel("Показать дома, учтённые в расчёте", { exact: true }).uncheck();
  await page.waitForTimeout(300);
  current = await sourceUpdates();
  assert.equal(current.parkings || 0, previous.parkings || 0);
  check("Погода не пересылает геометрию своих дорог; изменение слоя домов не пересылает парковки");

  const result = await demo(page);
  assert(result.comparison.changed_trip_count > 0);
  assert.equal(result.applied_settings.parking_occupancy_after[first.parking_id], 73);
  check("Демо-расчёт работает и получает введённую занятость виртуализированной строки");

  await page.getByRole("button", { name: "Продолжить анимацию", exact: true }).click();
  const animationStart = await countCars();
  await page.waitForFunction(start => (window.__sourceUpdates.cars || 0) > start, animationStart, { timeout: 20000 });
  const sampleStart = await countCars();
  await page.waitForTimeout(1100);
  assert((await countCars()) - sampleStart <= 13);
  assert(await page.evaluate(() => window.__carFeatureCount > 0 && window.__carFeatureCount <= 48));
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
  const hiddenStart = await countCars();
  await page.waitForTimeout(600);
  assert.equal(await countCars(), hiddenStart);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(start => (window.__sourceUpdates.cars || 0) > start, hiddenStart, { timeout: 20000 });
  await page.getByRole("button", { name: "Приостановить анимацию", exact: true }).click();
  check("Анимация ограничивает кадры и маркеры, останавливается при скрытии документа и возобновляется");

  await page.getByRole("button", { name: "Настроить слои карты", exact: true }).click();
  await page.getByLabel("Экономить ресурсы", { exact: true }).uncheck();
  await page.waitForFunction(() => { const el = document.querySelector(".map-canvas canvas"); return el.width === el.clientWidth * 2; });
  await page.getByLabel("Экономить ресурсы", { exact: true }).check();
  await page.waitForFunction(() => { const el = document.querySelector(".map-canvas canvas"); return el.width === el.clientWidth; });
  assert(await page.evaluate(() => document.querySelector(".map-canvas canvas") === window.__originalMapCanvas));
  check("Качество карты переключается без пересоздания canvas");

  await page.close();
  const mobile = await createPage(browser, errors, 390, 844, { reducedMotion: "reduce" });
  await mobile.goto(base); await ready(mobile); await openScenario(mobile); await openDetails(mobile, ".parking-editor"); await mobile.getByRole("button", { name: "Открыть полный каталог", exact: true }).click();
  await mobile.locator(".parking-setting").first().waitFor();
  assert(await mobile.locator(".parking-setting").count() <= 16);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.locator(".mobile-tabbar").getByRole("button", { name: "Карта", exact: true }).click();
  await mobile.getByRole("button", { name: "Настроить слои карты", exact: true }).click();
  assert(await mobile.getByRole("button", { name: "Продолжить анимацию", exact: true }).isDisabled());
  check("На телефоне виртуальный список не создаёт переполнения; reduced motion соблюдается");
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/performance-browser-check.json", JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
