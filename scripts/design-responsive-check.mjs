import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { base, launch, createPage, ready, openScenario, openResult, screenshot, demo, showMap } from "./design-test-utils.mjs";

const sizes = [[320,568],[360,800],[375,667],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1280,800],[1440,900],[1920,1080],[844,390]];
const browser = await launch(), errors = [], measurements = [], checks = [], contrastChecks = [];
let page;
function clsFrom(entries) {
  let highest = 0, session = 0, first = 0, previous = 0;
  for (const entry of entries.filter(e => !e.recent)) {
    if (session === 0 || entry.time - previous >= 1000 || entry.time - first >= 5000) { session = entry.value; first = entry.time; }
    else session += entry.value;
    previous = entry.time; highest = Math.max(highest, session);
  }
  return highest;
}
async function instrument(target) {
  await target.addInitScript(() => {
    window.__designShifts = [];
    window.__designObserverSupported = PerformanceObserver.supportedEntryTypes.includes("layout-shift");
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__designShifts.push({ value: entry.value, time: entry.startTime, recent: entry.hadRecentInput, sources: (entry.sources || []).map(s => s.node?.className || s.node?.nodeName || "") }); }).observe({ type: "layout-shift", buffered: true });
  });
}
async function verifyContrast(target, theme) {
  const tokens = await target.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(["text","muted","faint","surface","surface-2","accent","accent-soft","green","green-soft","red","red-soft","amber","amber-soft"].map(name=>[name,style.getPropertyValue("--"+name).trim()]));
  });
  const luminance = hex => { const s=hex.replace("#","");const rgb=(s.length===3?s.split("").map(c=>c+c).join(""):s).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; };
  for(const [fg,bg] of [["text","surface"],["muted","surface"],["muted","surface-2"],["faint","surface"],["accent","accent-soft"],["green","green-soft"],["red","red-soft"],["amber","amber-soft"]]) {
    const a=luminance(tokens[fg]),b=luminance(tokens[bg]);const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert(ratio>=4.5,`Контраст ${fg}/${bg} ${ratio.toFixed(2)}:1 ниже AA в теме ${theme}`);
    contrastChecks.push({theme,foreground:fg,background:bg,ratio:Number(ratio.toFixed(2))});
  }
}
async function record(target, label, width, height, theme, sample = 1) {
  await target.waitForTimeout(250);
  const blank = await browser.newPage(); await blank.goto("about:blank"); await blank.bringToFront(); await target.waitForTimeout(120);
  const data = await target.evaluate(() => ({ supported: window.__designObserverSupported, shifts: window.__designShifts, vitals: window.__farpostVitals || {}, overflow: document.documentElement.scrollWidth > innerWidth }));
  await blank.close(); await target.bringToFront();
  assert(data.supported, "Chrome должен поддерживать измерение layout-shift");
  const cls = clsFrom(data.shifts);
  const result = { label, width, height, theme, sample, cls: Number(cls.toFixed(6)), webVitalsCLS: data.vitals.CLS ?? null, overflow: data.overflow, shifts: data.shifts.filter(s => !s.recent) };
  measurements.push(result); console.log(JSON.stringify(result));
  assert.equal(data.overflow, false, `Горизонтальная прокрутка: ${label}`);
  assert(cls <= .05, `CLS ${cls} превышает 0,05: ${label}`);
  return result;
}
try {
  for (const [width,height] of sizes) {
    page = await createPage(browser, errors, width, height, { colorScheme: "light" }); await instrument(page);
    if (width === 390) {
      const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.route("**/api/**", async route => { await new Promise(r => setTimeout(r, 750)); await route.continue(); });
    }
    await page.goto(base);
    if(width === 390) { await page.locator(".app-header").waitFor(); await screenshot(page,"mobile-loading"); }
    await ready(page); const canvas = await page.locator(".map-canvas canvas").elementHandle();
    if(width===390) await verifyContrast(page,"light");
    await screenshot(page,`viewport-${width}x${height}`);
    await record(page,"cold-load",width,height,"light");
    await openScenario(page); await screenshot(page,`scenario-${width}x${height}`);
    const button = await page.locator(".calculate-button").boundingBox();
    assert(button.x >= 0 && button.x + button.width <= width + 1);
    assert(button.y >= 0 && button.y + button.height <= height + 1);
    if(await page.locator(".mobile-tabbar").isVisible()) {
      const nav=await page.locator(".mobile-tabbar").boundingBox(); assert(button.y+button.height <= nav.y+1);
      const hit=await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest(".mobile-tabbar")),{x:nav.x+nav.width/2,y:nav.y+nav.height/2}); assert(hit,"Нижняя навигация не должна перекрываться панелью");
    }
    assert.equal(await canvas.evaluate(el=>el.isConnected),true);
    await openResult(page); await screenshot(page,`empty-result-${width}x${height}`); await showMap(page);
    if(width===390) { await demo(page); await screenshot(page,"mobile-slow-result"); await record(page,"delayed-data-and-result",width,height,"light"); }
    await page.close(); checks.push(`Разметка и действия ${width}×${height}`);
  }
  for(const [width,height] of [[320,568],[390,844],[768,1024],[1440,900]]) for(const sample of [2,3]) {
    page=await createPage(browser,errors,width,height,{colorScheme:"light"});await instrument(page);await page.goto(base);await ready(page);await record(page,"cold-load",width,height,"light",sample);await page.close();
  }
  for(const [width,height] of [[390,844],[1440,900]]) {
    page=await createPage(browser,errors,width,height,{colorScheme:"dark",reducedMotion:"reduce"});await instrument(page);await page.goto(base);await ready(page);await openScenario(page);await screenshot(page,`dark-reduced-${width}`);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),"dark");
    if(width===390) await verifyContrast(page,"dark");
    if (width <= 900) { await showMap(page); await page.getByRole("button", { name: "Настроить слои карты", exact: true }).click(); }
    assert.equal(await page.getByRole("button",{name:"Продолжить анимацию",exact:true}).count(),1);
    assert.equal(await page.getByRole("button",{name:"Продолжить анимацию",exact:true}).isDisabled(),true);
    if (width <= 900) await page.getByRole("button", { name: "Закрыть слои", exact: true }).click();
    await demo(page);await screenshot(page,`dark-result-${width}`);await record(page,"dark-and-reduced-motion",width,height,"dark");await page.close();
  }
  checks.push("Системная тёмная тема и reduced motion работают на телефоне и компьютере");
  page=await createPage(browser,errors,720,450,{deviceScaleFactor:2});await instrument(page);await page.goto(base);await ready(page);
  await openScenario(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot(page,"zoom-200-percent");
  await page.getByRole("button",{name:"Как это работает",exact:true}).click();await page.keyboard.press("Tab");assert(await page.locator(".help-dialog").evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press("Escape");await page.close();
  checks.push("Reflow для масштаба 200%: CSS viewport 720×450 при DPR 2; клавиатурная работа справки проверена");
  page=await createPage(browser,errors,390,844);await instrument(page);let fail=true;
  await page.route("**/api/map",route=>fail?route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({detail:"Проверка временной недоступности API"})}):route.continue());
  await page.goto(base);await page.locator(".connection-error").waitFor();await screenshot(page,"mobile-connection-error");fail=false;await page.getByRole("button",{name:"Повторить подключение",exact:true}).click();await ready(page);await record(page,"connection-error-and-retry",390,844,"light");await page.close();
  checks.push("Ошибка первого подключения и повтор сохраняют устойчивую оболочку");
  assert.deepEqual(errors,[]);
  const report={checks,errors,measurements,contrastChecks,maxCLS:Math.max(...measurements.map(x=>x.cls)),conditions:{browser:"Installed Chrome, headless",renderer:"ANGLE SwiftShader",deviceScaleFactor:1,physicalDevice:false,production:true,realMobileSafari:false,network:"localhost; 750 ms delay and 4× CPU throttle in the first 390 px scenario",zoom:"200% equivalent: CSS viewport 720×450, DPR 2"}};
  await writeFile("artifacts/design/responsive-report.json",JSON.stringify(report,null,2));console.log(JSON.stringify({checks:checks.length,measurements:measurements.length,maxCLS:report.maxCLS,errors}));
} catch(error) {if(page&&!page.isClosed())await screenshot(page,"responsive-failure").catch(()=>{});await writeFile("artifacts/design/responsive-partial.json",JSON.stringify({checks,errors,measurements},null,2));console.error(error);process.exitCode=1;}
finally{await browser.close();}
