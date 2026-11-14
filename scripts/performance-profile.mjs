import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { launch, createPage, ready, openScenario, openDetails } from './design-test-utils.mjs';

const browser = await launch();
const errors = [];
try {
  const page = await createPage(browser, errors, 1280, 800, { deviceScaleFactor: 2, reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.__sourceUpdates = {};
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.type === 'LD') {
        const source = message.data?.source || 'unknown';
        window.__sourceUpdates[source] = (window.__sourceUpdates[source] || 0) + 1;
      }
      return original.call(this, message, ...rest);
    };
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.send('Performance.enable');
  await page.goto('http://127.0.0.1:3000');
  await page.bringToFront();
  await ready(page);
  await page.waitForTimeout(500);
  const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  const firstUpdates = await page.evaluate(() => ({ ...window.__sourceUpdates }));
  await page.waitForTimeout(3000);
  const after = await metrics();
  const updates = await page.evaluate(() => ({ ...window.__sourceUpdates }));
  const idle = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(k => [k, +(after[k] - before[k]).toFixed(4)]));
  const idleSourceUpdates = Object.fromEntries(Object.keys(updates).map(k => [k, updates[k] - (firstUpdates[k] || 0)]));
  const canvas = await page.locator('.map-canvas canvas').evaluate(el => ({ width: el.width, height: el.height, cssWidth: el.clientWidth, cssHeight: el.clientHeight }));
  await openScenario(page);
  await openDetails(page, '.parking-editor');
  const loadMore = page.getByRole('button', { name: /^Показать ещё/ });
  if (await loadMore.count()) {
    for (let i = 0; i < 9; i++) await loadMore.click();
  } else {
    await page.locator('.parking-settings').evaluate(el => { el.scrollTop = 300 * 180; });
    await page.waitForTimeout(300);
  }
  const rows = await page.locator('.parking-setting').count();
  const dom = await page.evaluate(() => document.querySelectorAll('*').length);
  const startUpdates = await page.evaluate(() => ({ ...window.__sourceUpdates }));
  await page.getByRole('button', { name: /^Дождь/ }).click();
  await page.waitForTimeout(700);
  const endUpdates = await page.evaluate(() => ({ ...window.__sourceUpdates }));
  const settingSourceUpdates = Object.fromEntries(Object.keys(endUpdates).filter(k => k !== 'cars').map(k => [k, endUpdates[k] - (startUpdates[k] || 0)]));
  const report = { browser: browser.version(), rendering: "headless Chrome; ANGLE/SwiftShader launch flags", reducedMotion: "no-preference", cpuThrottle: 4, sampleMs: 3000, idle, idleSourceUpdates, settingSourceUpdates, canvas, parkingRowsInDOM: rows, totalDOMNodes: dom, errors };
  const path = process.argv[2] || 'artifacts/performance-profile.json';
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
