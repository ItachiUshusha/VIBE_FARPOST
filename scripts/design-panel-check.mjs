import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { base, launch, createPage, ready, screenshot, swipe } from "./design-test-utils.mjs";

const browser = await launch(), errors = [], checks = [];
let page;
async function actionIsReachable() {
  await page.waitForFunction(() => {
    const button = document.querySelector(".calculate-button")?.getBoundingClientRect();
    const nav = document.querySelector(".mobile-tabbar")?.getBoundingClientRect();
    return button && nav && button.y >= 0 && button.bottom <= nav.y + 1;
  });
  const button = await page.locator(".calculate-button").boundingBox();
  const nav = await page.locator(".mobile-tabbar").boundingBox();
  assert(button && button.y >= 0 && button.y + button.height <= nav.y + 1);
  assert(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".calculate-button")), { x: button.x + button.width / 2, y: button.y + button.height / 2 }), "Кнопка расчёта должна быть доступна для касания");
}
try {
  for (const [name, width, height] of [["small-phone", 320, 568], ["phone", 390, 844], ["tablet", 820, 1180]]) {
    page = await createPage(browser, errors, width, height);
    await page.goto(base); await ready(page);
    const canvas = await page.locator(".map-canvas canvas").elementHandle();
    await page.locator(".mobile-tabbar").getByRole("button", { name: "Сценарий", exact: true }).click();
    await page.waitForTimeout(400);
    await actionIsReachable();
    await screenshot(page, `panel-${name}-partial`);
    await page.getByRole("button", { name: "Раскрыть панель полностью", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".control-sheet")?.getBoundingClientRect().y < 90);
    await actionIsReachable();
    await screenshot(page, `states-${name}-scenario`);
    const fullPanel = await page.locator(".control-sheet").boundingBox();
    const handle = await page.locator(".control-sheet .sheet-drag-zone").boundingBox();
    const touch = await page.context().newCDPSession(page);
    const origin = { x: handle.x + handle.width / 2, y: handle.y + 12 };
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [origin] });
    for (let step = 1; step <= 24; step++) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: origin.x, y: origin.y + fullPanel.height * .64 * step / 24 }] });
      await page.waitForTimeout(25);
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await page.locator(".control-sheet.sheet-compact.modal-in").waitFor();
    assert.equal(await page.locator(".panel-scroll").isVisible(), false);
    await screenshot(page, `panel-${name}-compact`);
    await page.getByRole("button", { name: "Раскрыть панель полностью", exact: true }).tap();
    await page.waitForFunction(() => document.querySelector(".control-sheet")?.getBoundingClientRect().y < 90);
    await swipe(page, { x: handle.x + handle.width / 2, y: handle.y + 12 }, { x: handle.x + handle.width / 2, y: height - 90 });
    await page.waitForTimeout(400);
    const nav = await page.locator(".mobile-tabbar").boundingBox();
    assert(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".mobile-tabbar")), { x: nav.x + nav.width / 2, y: nav.y + nav.height / 2 }));
    await screenshot(page, `panel-${name}-swiped`);
    await page.locator(".mobile-tabbar").getByRole("button", { name: "Карта", exact: true }).tap();
    await page.waitForTimeout(350);
    assert.equal(await canvas.evaluate(el => el.isConnected), true);
    if (name === "phone") {
      await page.getByRole("button", { name: "Включить тёмную тему", exact: true }).tap();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.waitForTimeout(600);
      await screenshot(page, "manual-dark-phone");
      assert.equal(await canvas.evaluate(el => el.isConnected), true);
    }
    checks.push(`${width}×${height}: компактное, рабочее и полное раскрытие; основное действие и навигация доступны; свайп сохраняет карту`);
    console.log("OK", checks.at(-1));
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile("artifacts/design/panel-report.json", JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await screenshot(page, "panel-failure").catch(() => {});
  throw error;
} finally { await browser.close(); }
