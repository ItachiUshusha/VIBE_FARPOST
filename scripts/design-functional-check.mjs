import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { base, launch, createPage, ready, openScenario, openResult, showMap, reset, openDetails, calculate, demo, screenshot, resetCamera, clickMap, nearStreet, swipe, chooseMapAction } from "./design-test-utils.mjs";

const catalog = await (await fetch(base + "/api/catalogs")).json();
const mapData = await (await fetch(base + "/api/map")).json();

export async function runRegression() {
  const browser = await launch(), errors = [], checks = [];
  let page;
  const check = text => { checks.push(text); console.log("OK", text); };
  let result;
  try {
    page = await createPage(browser, errors); await page.goto(base); await ready(page);
    assert.equal(await page.locator(".map-canvas canvas").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot(page, "desktop-initial"); check("Базовая карта и исходные показатели загружены; горизонтального переполнения нет");
    result = await demo(page);
    assert(result.comparison.changed_trip_count > 0); assert(result.comparison.top_increased_edges[0].absolute > 0);
    assert(!result.after.routes.features.some(f => f.properties.edge_ids.some(id => result.closed_edge_ids.includes(id))));
    await screenshot(page, "desktop-result"); check("Демо меняет маршруты и нагрузку; закрытые рёбра исключены");
    await page.getByRole("button", { name: "До изменения", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "До изменения", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "После изменения", exact: true }).click(); check("Фазы До / После переключаются без перезагрузки");
    await page.getByRole("button", { name: "Объяснить результат", exact: false }).click(); await page.getByText("Почему так произошло", { exact: true }).waitFor();
    const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Скачать результат расчёта", exact: true }).click();
    await (await downloadPromise).saveAs("artifacts/design/export-demo.json");
    check("Объяснение читается из сохранённого расчёта; JSON экспортируется");
    await page.getByRole("button", { name: "Настроить слои карты", exact: true }).click();
    await page.getByLabel("Подложка OpenStreetMap", { exact: true }).check(); await page.getByLabel("Подложка OpenStreetMap", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Закрыть слои", exact: true }).click();
    check("Локальная карта остаётся доступной после выключения внешней подложки");
    await reset(page); await openScenario(page);
    assert.equal(await page.getByRole("button", { name: "После изменения", exact: true }).isDisabled(), true); check("Сброс возвращает исходное состояние");
    await openDetails(page, ".parking-editor"); await page.getByLabel("Показать парковки на карте", { exact: true }).uncheck();
    await openDetails(page, ".housing-editor"); await page.getByLabel("Показать дома, учтённые в расчёте", { exact: true }).uncheck();
    const road = mapData.edges.features.filter(f => f.properties.can_close && f.properties.name === "Океанский проспект").map(f => ({ f, point: f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)] })).sort((a, b) => Math.hypot(a.point[0] - mapData.center[0], a.point[1] - mapData.center[1]) - Math.hypot(b.point[0] - mapData.center[0], b.point[1] - mapData.center[1]))[0];
    await clickMap(page, mapData, road.point); await page.locator(".selected-road").waitFor(); check("Выбор реальной дороги на карте открывает её параметры");
    await page.getByRole("button", { name: "Сужение", exact: true }).click();
    await page.route("**/api/simulate", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Проверочная ошибка API. Повторите запрос." }) }));
    await page.locator(".calculate-button").click(); await page.getByRole("alert").filter({ hasText: "Проверочная ошибка API" }).waitFor();
    assert.equal(await page.locator(".calculate-button").isDisabled(), false); await screenshot(page, "api-error"); await page.unroute("**/api/simulate");
    check("Ошибка API понятна; повторный запуск остаётся доступен");
    const narrow = await calculate(page); assert.equal(narrow.applied_settings.road_change.factor, .5); assert.deepEqual(narrow.closed_edge_ids, []); check("Сужение меняет ёмкость и оставляет участок открытым");
    await reset(page); await openScenario(page); await page.getByRole("button", { name: "Час пик", exact: true }).click();
    const peak = await calculate(page); assert.equal(peak.applied_settings.demand_factor, 1.4); assert(Math.abs(peak.after.metrics.vehicle_count - peak.before.metrics.vehicle_count * 1.4) < 1e-8); check("Час пик увеличивает спрос в 1,4 раза");
    await page.getByRole("button", { name: "Как это работает", exact: true }).click(); await page.locator(".help-dialog").waitFor(); await page.getByRole("button", { name: "Закрыть описание", exact: true }).click(); check("Справка открывается и закрывается");
    await page.close(); page = await createPage(browser, errors, 390, 844); await page.route("https://**/*", route => route.abort()); await page.goto(base); await ready(page);
    const mobileRun = await demo(page); assert(mobileRun.comparison.changed_trip_count > 0); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator(".mobile-tabbar").isVisible(), true); await screenshot(page, "mobile-result"); check("На телефоне расчёт и нижняя навигация работают без внешних запросов");
    await page.close(); page = await createPage(browser, errors, 1280, 800);
    await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return String(type).includes("webgl") ? null : original.call(this, type, ...args); }; });
    await page.goto(base); await ready(page); assert.equal(await page.locator(".svg-road").count(), 963);
    const before = await page.locator(".svg-map>g").getAttribute("transform"); await page.getByRole("button", { name: "Приблизить карту", exact: true }).click(); assert.notEqual(await page.locator(".svg-map>g").getAttribute("transform"), before);
    await demo(page); await screenshot(page, "no-webgl"); check("SVG-карта, масштабирование и демо доступны без WebGL");
    assert.deepEqual(errors, []);
    const report = { checks, errors, demo: { calculation_ms: result.calculation_ms, comparison: result.comparison } };
    await writeFile("artifacts/browser-check.json", JSON.stringify(report, null, 2)); return report;
  } catch (error) { if (page && !page.isClosed()) await screenshot(page, "regression-failure").catch(() => {}); throw error; }
  finally { await browser.close(); }
}

export async function runExtended() {
  const browser = await launch(), errors = [], checks = [];
  let page;
  const check = text => { checks.push(text); console.log("OK", text); };
  try {
    page = await createPage(browser, errors); await page.goto(base); await ready(page);
    assert(catalog.parkings.every(p => !p.is_demo && p.source_tags.amenity === "parking" && p.source_url.endsWith(p.source_id)));
    assert.equal(catalog.config.k_auto, 1); check("Каталог парковок содержит реальные объекты OSM; коэффициент дома равен 1");
    const canvasHandle = await page.locator(".map-canvas canvas").elementHandle();
    await openResult(page); await openScenario(page); await page.getByRole("button", { name: "Включить тёмную тему", exact: true }).click();
    assert.equal(await canvasHandle.evaluate(el => el.isConnected), true); await screenshot(page, "desktop-dark");
    await page.getByRole("button", { name: "Включить светлую тему", exact: true }).click(); check("Смена разделов и темы сохраняет один экземпляр карты");
    const box = await page.locator(".map-canvas").boundingBox(); let cluster = null;
    for (let y = .32; y <= .78 && !cluster; y += .09) for (let x = .3; x <= .76; x += .07) { const point = { x: box.x + box.width * x, y: box.y + box.height * y }; await page.mouse.move(point.x, point.y); await page.waitForTimeout(35); if ((await page.locator(".map-tooltip").allTextContents()).join("").includes("Парковок в группе")) { cluster = point; break; } }
    assert(cluster); await page.mouse.click(cluster.x, cluster.y); await page.waitForTimeout(400); assert.equal(await page.locator(".selected-road").count(), 0); await resetCamera(page); check("Клик по группе парковок приближает её без выбора дороги");
    await page.getByLabel("Автомобилей в районе", { exact: true }).fill("1500");
    await page.waitForResponse(r => r.url().includes("/api/baseline?vehicle_count=1500") && r.status() === 200);
    let result = await calculate(page); assert.equal(result.before.metrics.vehicle_count, 1500); check("Выбранные 1500 авто используются в исходном потоке и расчёте");
    await reset(page); await openScenario(page);
    await page.route("**/api/baseline*", async route => { if (route.request().url().includes("vehicle_count=1800")) await new Promise(resolve => setTimeout(resolve, 4000)); await route.continue(); });
    const refreshed = page.waitForResponse(response => response.url().includes("/api/baseline?vehicle_count=1800") && response.status() === 200);
    await page.getByLabel("Автомобилей в районе", { exact: true }).fill("1800"); await page.waitForTimeout(300);
    await chooseMapAction(page, "Мой маршрут");
    await clickMap(page, mapData, nearStreet(mapData, 131.8994, 43.1304)); await clickMap(page, mapData, mapData.center);
    await page.waitForFunction(() => document.querySelectorAll(".route-pin").length === 2);
    assert.equal(await page.locator(".calculate-button").isDisabled(), true);
    await refreshed; await page.unroute("**/api/baseline*");
    check("Постановка точек доступна при обновлении потока; расчёт ждёт актуальной базы");
    await reset(page); await chooseMapAction(page, "Мой маршрут");
    await clickMap(page, mapData, nearStreet(mapData, 131.8994, 43.1304)); await clickMap(page, mapData, mapData.center);
    await page.waitForFunction(() => document.querySelectorAll(".route-pin").length === 2);
    await openScenario(page); await page.getByRole("button", { name: "Добавить точку «Через»", exact: true }).click(); await clickMap(page, mapData, [131.8982076, 43.1346499]);
    await openScenario(page); await page.getByLabel("Парковка у точки Б", { exact: true }).selectOption("manual");
    const parking = catalog.parkings[0]; await page.getByLabel("Выбранная парковка", { exact: true }).selectOption(parking.parking_id);
    await openDetails(page, ".parking-editor"); await page.getByLabel("Найти парковку", { exact: true }).fill(parking.source_id); await page.getByLabel(`Занятость ${parking.name}`).fill("75");
    await page.getByRole("button", { name: /^Дождь/ }).click(); await openDetails(page, ".housing-editor"); await page.getByRole("button", { name: `Снести дом ${catalog.houses[0].name}`, exact: true }).click();
    result = await calculate(page); assert.equal(result.personal_route.snapped_points.via.length, 1); assert.equal(result.personal_route.after.search_time_s, 180); assert.equal(result.after.metrics.vehicle_count, 980); assert.equal(result.applied_settings.weather_factor_after, .85);
    await screenshot(page, "desktop-composite"); check("Точки А / Через / Б, дождь, парковка 75% и удаление дома работают вместе");
    await page.getByRole("button", { name: "До изменения", exact: true }).click(); await page.getByRole("button", { name: "После изменения", exact: true }).click(); assert.equal(result.personal_route.after.parking_included, true); check("Личная поездка включает автомобильный, парковочный и пеший этапы");
    await openScenario(page); await page.getByLabel(`Занятость ${parking.name}`).fill("100"); result = await calculate(page);
    assert.equal(result.personal_route.after.status, "ok"); assert.equal(result.personal_route.after.parking_status, "parking_full"); assert(result.personal_route.after.car_route); assert.equal(result.personal_route.after.total_time_s, result.personal_route.after.drive_time_s); assert.equal(result.personal_route.comparison.absolute, null);
    await page.locator(".personal-parking-warning").filter({ hasText: /мест нет/ }).waitFor(); await screenshot(page, "parking-warning"); check("Заполненная парковка даёт отдельное предупреждение, сохраняя маршрут до Б");
    await openScenario(page); await page.getByLabel(`Занятость ${parking.name}`).fill("50"); await page.getByRole("button", { name: /^Сухо/ }).click(); await page.getByRole("button", { name: `Вернуть дом ${catalog.houses[0].name}`, exact: true }).click(); await calculate(page);
    await openScenario(page); await page.getByLabel(`Занятость ${parking.name}`).fill("75"); result = await calculate(page); assert(Math.abs(result.personal_route.comparison.absolute - 120) < 1e-6); check("Изменение занятости 50% → 75% добавляет ровно 120 секунд");
    await openScenario(page); await page.getByLabel("Парковка у точки Б", { exact: true }).selectOption("auto"); result = await calculate(page);
    const chosen = result.personal_route.after.parking; await openScenario(page); await page.getByLabel("Найти парковку", { exact: true }).fill(chosen.source_id); await page.getByLabel(`Занятость ${chosen.name}`).fill("100"); result = await calculate(page);
    assert.notEqual(result.personal_route.after.parking.parking_id, chosen.parking_id);
    const eligible = result.personal_route.after.alternatives.filter(a => a.status === "ok").sort((a,b) => a.total_time_s - b.total_time_s || a.parking.parking_id.localeCompare(b.parking.parking_id)); assert.equal(result.personal_route.after.parking.parking_id, eligible[0].parking.parking_id); check("Автовыбор сменяет заполненную парковку и минимизирует общее время");
    await resetCamera(page); await chooseMapAction(page, "Добавить дом"); await clickMap(page, mapData, mapData.center);
    await page.locator(".house-map-editor").waitFor(); assert.equal(await page.getByLabel("Количество жильцов", { exact: true }).inputValue(), "40");
    await page.getByLabel("Количество жильцов", { exact: true }).fill("125"); await page.getByLabel("Куда поедут жители", { exact: true }).selectOption(catalog.terminals[1].terminal_id); await screenshot(page, "desktop-house"); await page.getByRole("button", { name: "Готово", exact: true }).click();
    const marker = page.locator(".house-pin"); const markerBox = await marker.boundingBox(); await page.mouse.move(markerBox.x + 16, markerBox.y + 16); await page.mouse.down(); await page.mouse.move(markerBox.x + 35, markerBox.y + 29, { steps: 8 }); await page.mouse.up(); await marker.click();
    assert.equal(await page.getByLabel("Количество жильцов", { exact: true }).inputValue(), "125"); assert.equal(await page.getByLabel("Куда поедут жители", { exact: true }).inputValue(), catalog.terminals[1].terminal_id);
    await page.getByLabel("Количество жильцов", { exact: true }).fill("40"); await page.getByRole("button", { name: "Готово", exact: true }).click(); check("Дом появляется сразу; повторное редактирование и перенос сохраняют его настройки");
    await openScenario(page); result = await calculate(page); assert.equal(result.after.metrics.vehicle_count, 1040); assert.equal(result.house_changes.added[0].vehicle_count, 40); check("Дом на 40 жителей добавляет ровно 40 авто отдельной группой");
    await openScenario(page); await page.getByRole("button", { name: /^Снег/ }).click(); result = await calculate(page); assert.equal(result.applied_settings.weather_factor_after, .7); check("Снег применяется совместно с остальными условиями");
    await reset(page); assert.equal(await page.locator(".house-pin,.route-pin").count(), 0); check("Сброс очищает метки и настройки, сохраняя карту");
    await page.close(); page = await createPage(browser, errors, 390, 844); await page.route("https://**/*", route => route.abort()); await page.goto(base); await ready(page);
    const mobileCanvas = await page.locator(".map-canvas canvas").elementHandle();
    await page.locator(".mobile-tabbar").getByRole("button", { name: "Сценарий", exact: true }).click(); await page.waitForTimeout(350);
    const panel = await page.locator(".control-sheet").boundingBox(); const nav = await page.locator(".mobile-tabbar").boundingBox();
    const primary = await page.locator(".calculate-button").boundingBox(); assert(primary.y + primary.height <= nav.y + 1);
    const handle = await page.locator(".control-sheet .sheet-drag-zone").boundingBox(); await swipe(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2, y: Math.min(760, handle.y + 290) });
    await openScenario(page); assert.equal(await mobileCanvas.evaluate(el => el.isConnected), true); check("Нативный свайп Framework7 и нижняя навигация работают; основное действие остаётся доступным");
    await openDetails(page, ".route-editor"); await page.getByRole("button", { name: "Пример маршрута с парковкой", exact: true }).click(); await page.getByRole("button", { name: /^Снег/ }).click(); result = await calculate(page); assert.equal(result.personal_route.after.status, "ok"); await screenshot(page, "mobile-personal-result");
    await page.getByRole("button", { name: "Показать поездку на карте", exact: true }).click(); await resetCamera(page); await chooseMapAction(page, "Добавить дом"); await clickMap(page, mapData, mapData.center);
    await page.getByLabel("Количество жильцов", { exact: true }).fill("30"); await screenshot(page, "mobile-house");
    const done = await page.getByRole("button", { name: "Готово", exact: true }).boundingBox(); const house = await page.locator(".house-sheet").boundingBox(); assert(done.y >= house.y && done.y + done.height <= house.y + house.height + 1);
    await page.setViewportSize({ width:390,height:500 }); await page.getByLabel("Количество жильцов", { exact: true }).focus(); await screenshot(page, "mobile-house-short-viewport");
    await page.getByRole("button", { name: "Готово", exact: true }).click(); await page.setViewportSize({ width:390,height:844 }); await openScenario(page); result = await calculate(page); assert.equal(result.house_changes.added[0].vehicle_count, 30); check("Мобильный маршрут и дом работают без внешних запросов; карточка доступна при уменьшении высоты окна");
    await page.setViewportSize({ width:844,height:390 }); await showMap(page); assert.equal(await mobileCanvas.evaluate(el => el.isConnected), true); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await screenshot(page, "mobile-landscape");
    check("Поворот экрана сохраняет карту, метки и расчёт без горизонтальной прокрутки");
    assert.deepEqual(errors, []); const report={checks,errors}; await writeFile("artifacts/extension-browser-check.json",JSON.stringify(report,null,2));return report;
  } catch(error){if(page&&!page.isClosed())await screenshot(page,"extension-failure").catch(()=>{});throw error;}
  finally{await browser.close();}
}
