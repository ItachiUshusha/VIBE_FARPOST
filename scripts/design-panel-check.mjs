// Prepared for a future browser run. This script is not run as part of editing.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { base, launch, createPage, ready, openScenario, openResult, showMap, chooseMapAction, clickMap, swipe } from "./design-test-utils.mjs";

const sizes = [[320,568],[360,640],[375,667],[390,844],[412,915],[430,932],[568,320],[667,375],[844,390],[768,1024],[820,1180],[1440,900]];
const response = await fetch(base + "/api/map");
assert.equal(response.status, 200);
const mapData = await response.json();
assert(mapData.dataset_version && mapData.junctions?.length, "Нужен именно проект «Эффект бабочки» с каталогом перекрёстков");
const browser = await launch(), errors = [], measurements = [];
await mkdir("artifacts/mobile-ux", { recursive: true });
let page;
async function capture(name, width, height, mobile) {
  const target = page.locator(".app-dialog[open]").first();
  const surface = await target.isVisible() ? target : page.locator(".control-sheet");
  await page.waitForTimeout(380);
  const box = await surface.boundingBox();
  assert(box);
  if (mobile) { assert(Math.abs(box.x) <= 1, name); assert(Math.abs(box.x + box.width - width) <= 1, name); }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  measurements.push({ name, width, height, box });
  await page.screenshot({ path: `artifacts/mobile-ux/${name}-${width}x${height}.png` });
}
function roadEndpoints(box, hint, controls) {
  const world = ([lon, lat]) => {
    const size = 512 * 2 ** 14.8, sin = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * size, (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
  };
  const center = world(mapData.center);
  const candidates = mapData.junctions.map(junction => {
    const point = world(junction.coordinates);
    return { ...junction, x: box.x + box.width / 2 + point[0] - center[0], y: box.y + box.height / 2 + point[1] - center[1] };
  }).filter(point => point.x > box.x + 25 && point.x < box.x + box.width - 80 && point.y > hint.y + hint.height + 8 && point.y < controls.y - 8)
    .sort((a, b) => Math.hypot(a.x - box.x - box.width / 2, a.y - box.y - box.height / 2) - Math.hypot(b.x - box.x - box.width / 2, b.y - box.y - box.height / 2));
  const first = candidates[0];
  const second = candidates.find(point => point.node_id !== first?.node_id && Math.hypot(point.x - first.x, point.y - first.y) > 12);
  assert(first && second, "Два перекрёстка должны быть доступны между инструкцией и инструментами");
  return [first, second];
}
try {
  for (const [width, height] of sizes) {
    const mobile = width <= 900 || height <= 560 && width <= 1100;
    page = await createPage(browser, errors, width, height, { colorScheme: width === 412 ? "dark" : "light", reducedMotion: width === 430 ? "reduce" : "no-preference" });
    await page.goto(base); await ready(page);
    assert.match(await page.locator(".brand").innerText(), /Эффект бабочки/);
    const canvas = await page.locator(".map-canvas canvas").elementHandle();
    await openScenario(page); // No forced expansion: check the actual first opening.
    await capture("scenario", width, height, mobile);
    const button = await page.locator(".calculate-button").boundingBox();
    assert(button.height >= 48);
    if (mobile) {
      const nav = await page.locator(".mobile-tabbar").boundingBox();
      assert(button.y + button.height <= nav.y + 1);
      assert.equal(await page.locator(".panel-tabs").isVisible(), false);
    }
    await openResult(page); await capture("empty-result", width, height, mobile); await showMap(page);
    await page.getByRole("button", { name: "Как это работает", exact: true }).click();
    await capture("help", width, height, mobile);
    await page.locator(".help-content").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const closeHelp = await page.getByRole("button", { name: "Закрыть описание", exact: true }).boundingBox();
    assert(closeHelp.y >= 0 && closeHelp.y + closeHelp.height <= height);
    await page.getByRole("button", { name: "Закрыть описание", exact: true }).click();
    if (mobile) {
      await page.locator(".mobile-actions-trigger").click(); await capture("actions", width, height, true);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Настроить слои карты", exact: true }).click();
    await capture("map-settings", width, height, mobile);
    await page.getByRole("button", { name: "Закрыть слои", exact: true }).click();
    await chooseMapAction(page, "Добавить дом"); await clickMap(page, mapData, mapData.center);
    await page.locator(".house-sheet[open]").waitFor(); await capture("house", width, height, mobile);
    await page.getByLabel("Количество жильцов", { exact: true }).fill("");
    assert(await page.getByRole("button", { name: "Готово", exact: true }).isDisabled());
    assert(await page.getByRole("button", { name: "Закрыть настройки дома", exact: true }).isEnabled());
    await page.getByRole("button", { name: "Закрыть настройки дома", exact: true }).click();
    assert.equal(await page.locator(".house-pin").count(), 0);
    await chooseMapAction(page, "Своя дорога");
    const points = roadEndpoints(await page.locator(".map-canvas").boundingBox(), await page.locator(".placement-hint").boundingBox(), await page.locator(".road-draw-controls").boundingBox());
    for (const point of points) await page.mouse.click(point.x, point.y);
    await openScenario(page); await openResult(page); await showMap(page);
    assert.match(await page.locator(".road-draw-controls").innerText(), /2 точек/);
    await page.locator(".road-draw-controls").getByRole("button", { name: "Готово", exact: true }).click();
    await page.locator(".road-sheet[open]").waitFor(); await capture("road", width, height, mobile);
    assert.equal(await page.locator(".road-sheet").getAttribute("aria-label"), "Редактор дороги");
    await page.getByLabel("Название", { exact: true }).fill("");
    assert(await page.getByRole("button", { name: "Готово", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Закрыть настройки дороги", exact: true }).click();
    await openScenario(page); assert.equal(await page.locator(".custom-road-card").count(), 0);
    if (width === 390) {
      // Existing object: all ways of cancelling leave the applied value unchanged.
      await chooseMapAction(page, "Добавить дом"); await clickMap(page, mapData, mapData.center);
      await page.getByLabel("Количество жильцов", { exact: true }).fill("125");
      await page.getByRole("button", { name: "Готово", exact: true }).click();
      for (const mode of ["cancel", "escape", "backdrop", "swipe", "back"]) {
        await openScenario(page); await page.locator(".house-card.added .house-card-edit").click();
        await page.getByLabel("Количество жильцов", { exact: true }).fill("");
        if (mode === "cancel") await page.getByRole("button", { name: "Отмена", exact: true }).click();
        else if (mode === "escape") await page.keyboard.press("Escape");
        else if (mode === "backdrop") await page.mouse.click(5, 2);
        else if (mode === "back") await page.goBack();
        else { const heading = await page.locator(".house-sheet .editor-heading").boundingBox(); await swipe(page, { x: 70, y: heading.y + 20 }, { x: 70, y: heading.y + 140 }); }
        await page.locator(".house-sheet[open]").waitFor({ state: "hidden" });
        assert.equal(await page.locator(".app-shell").getAttribute("data-panel"), "scenario");
        assert.match(await page.locator(".house-card.added").innerText(), /125/);
      }
    }
    assert(await canvas.evaluate(element => element.isConnected));
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile("artifacts/mobile-ux/report.json", JSON.stringify({ url: base, dataset: mapData.dataset_version, sizes, measurements, errors, physicalDevice: false }, null, 2));
} finally { await browser.close(); }
