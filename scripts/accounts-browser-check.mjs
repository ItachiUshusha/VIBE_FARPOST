import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { launch, createPage, ready, openScenario, demo } from "./design-test-utils.mjs";

const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
const { base, api, password } = fixture;
const browser = await launch();
const errors = [], checks = [], analyticsRequests = [];
const check = value => { checks.push(value); console.log("OK", value); };
const name = "qa_" + randomBytes(5).toString("hex");
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  // The production rewrite manifest can point at the regular backend. Browser requests are routed to the isolated database.
  await context.route("**/api/**", async route => {
    if (route.request().url().includes("/api/auth/oauth/") && route.request().url().includes("/callback")) return route.continue();
    const target = new URL(route.request().url());
    if (target.origin !== base) return route.continue();
    const response = await route.fetch({ url: api + target.pathname + target.search, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  await context.route(/https:\/\/[^/]*yandex\.(ru|com|net)\//, async route => {
    const request = route.request();
    analyticsRequests.push({ url: request.url(), body: request.postData(), referer: request.headers().referer || "" });
    if (request.url().endsWith("/metrika/tag.js")) {
      const script = `const queued=window.ym.a||[];window.ym=(...args)=>{parent.postMessage({type:'qa-metrica',args},location.origin);fetch('https://mc.yandex.ru/watch/qa',{method:'POST',body:JSON.stringify(args)})};for(const args of queued)window.ym(...args);setInterval(()=>fetch('https://mc.yandex.ru/watch/heartbeat'),100);addEventListener('unload',()=>navigator.sendBeacon('https://mc.yandex.ru/watch/unload','late'));`;
      return route.fulfill({ status: 200, contentType: "application/javascript", body: script });
    }
    return route.fulfill({ status: 200, body: "ok" });
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { window.__qaCalls = []; addEventListener("message", event => { if (event.data?.type === "qa-metrica") window.__qaCalls.push(event.data.args); }); });

  await page.goto(base + "/?utm_source=vk&utm_medium=social&utm_campaign=launch&token=PRIVATE_TOKEN&email=owner@example.test#PRIVATE_HASH");
  await page.getByRole("region", { name: "Настройки cookie" }).waitFor();
  assert.equal(analyticsRequests.length, 0);
  assert.equal(await page.locator("iframe.analytics-frame").count(), 0);
  await page.getByRole("button", { name: "Только необходимые", exact: true }).click();
  await ready(page);
  assert.equal(analyticsRequests.length, 0);
  check("До согласия и после выбора необходимых cookie нет загрузки Метрики; карта работает");

  await page.getByRole("button", { name: "Настройки cookie", exact: true }).click();
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  await page.waitForFunction(() => window.__qaCalls.some(call => call[1] === "hit"));
  let hits = await page.evaluate(() => window.__qaCalls.filter(call => call[1] === "hit"));
  assert.equal(hits.length, 1);
  assert.equal(new URL(hits[0][2]).searchParams.get("utm_campaign"), "launch");
  assert(!JSON.stringify(analyticsRequests).includes("PRIVATE_TOKEN"));
  assert(!JSON.stringify(analyticsRequests).includes("owner@example.test"));
  assert(!JSON.stringify(analyticsRequests).includes("PRIVATE_HASH"));
  await page.getByRole("link", { name: "Правовая информация", exact: true }).click();
  await page.getByRole("heading", { name: "Документ ещё не опубликован", exact: true }).waitFor();
  await page.waitForFunction(() => window.__qaCalls.filter(call => call[1] === "hit").length >= 2);
  hits = await page.evaluate(() => window.__qaCalls.filter(call => call[1] === "hit"));
  assert.equal(hits.filter(call => new URL(call[2]).pathname === "/legal").length, 1);
  check("После согласия счётчик получает очищенные UTM и один просмотр на SPA-переход; токены, email и hash не передаются");

  await page.goto(base + "/register");
  await page.getByLabel("Логин", { exact: true }).fill(name);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.locator(".service-check input").check();
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await page.waitForURL(base + "/account");
  await page.waitForFunction(() => window.__qaCalls.some(call => call[1] === "reachGoal" && call[2] === "registration_success"));
  assert.equal(await page.evaluate(() => window.__qaCalls.filter(call => call[1] === "reachGoal" && call[2] === "registration_success").length), 1);
  assert((await context.cookies()).find(cookie => cookie.name === "fp_session")?.httpOnly);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(base + "/");
  await page.goto(base + "/login");
  await page.getByLabel("Логин или email", { exact: true }).fill(name);
  await page.getByLabel("Пароль", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Неверный логин или пароль" }).waitFor();
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(base + "/account");
  await page.waitForFunction(() => window.__qaCalls.some(call => call[1] === "reachGoal" && call[2] === "login_success"));
  assert.equal((await context.request.get(api + "/api/admin/guard")).status(), 403);
  check("Регистрация без email, повторный вход, неверный пароль, HttpOnly-сессия и однократные цели работают");

  await page.getByRole("link", { name: /Эффект бабочки/ }).click();
  await ready(page);
  const result = await demo(page);
  assert(result.comparison.changed_trip_count > 0);
  await page.waitForFunction(() => window.__qaCalls.some(call => call[1] === "reachGoal" && call[2] === "simulation_success"));
  assert.equal((await context.request.get(api + "/api/account/runs")).status(), 200);
  const guest = await browser.newContext();
  assert.equal((await guest.request.get(api + "/api/admin/guard")).status(), 401);
  assert.equal((await guest.request.get(api + "/api/runs/" + result.run_id)).status(), 404);
  await guest.close();
  await page.goto(base + "/admin");
  await page.getByRole("heading", { name: "Доступ запрещён", exact: true }).waitFor();
  assert.equal(await page.locator("iframe.analytics-frame").count(), 0);
  const adminRequests = analyticsRequests.length;
  await page.waitForTimeout(400);
  assert.equal(analyticsRequests.length, adminRequests);
  check("Сохранённый расчёт приватен; гость и пользователь не получают админку; аналитики в админке нет");

  await page.goto(base + "/account");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.goto(base + "/login");
  await page.getByLabel("Логин или email", { exact: true }).fill("qa-admin");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(base + "/account");
  await page.getByRole("link", { name: "Открыть администрирование →", exact: true }).click();
  await page.getByRole("heading", { name: "Обзор", exact: true }).waitFor();
  await page.locator(".admin-metrics strong").first().waitFor();
  await page.getByRole("link", { name: "Пользователи", exact: true }).click();
  await page.getByRole("searchbox", { name: "Поиск записей", exact: true }).fill(name);
  await page.getByRole("cell", { name, exact: true }).first().waitFor();
  await page.getByRole("link", { name: "Открыть →", exact: true }).first().click();
  await page.getByLabel("Статус", { exact: true }).selectOption("blocked");
  await page.getByRole("button", { name: "Сохранить права и статус", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector('select')?.value === 'user');
  await page.getByRole("link", { name: "Шаблоны", exact: true }).click();
  await page.getByRole("link", { name: "Создать шаблон", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Приёмочный час пик");
  await page.getByLabel("Тип сценария", { exact: true }).selectOption("demand_increase");
  await page.getByLabel("Множитель количества машин", { exact: true }).fill("1.7");
  await page.getByRole("button", { name: "Создать шаблон", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.waitForURL(/\/admin\/presets\/user-/);
  await page.getByRole("heading", { name: "Настройки шаблона", exact: true }).waitFor();
  await page.getByRole("link", { name: "Источники и конверсии", exact: true }).click();
  await page.getByText("Не настроена", { exact: true }).waitFor();
  assert.equal(await page.locator("iframe.analytics-frame").count(), 0);
  await page.getByRole("link", { name: "Журнал изменений", exact: true }).click();
  await page.getByRole("cell", { name: "user.update", exact: true }).waitFor();
  await page.getByRole("cell", { name: "preset.create", exact: true }).waitFor();
  await mkdir("artifacts/services", { recursive: true });
  await page.screenshot({ path: "artifacts/services/admin-desktop.png" });
  check("Администратор видит реальные показатели, фильтрует пользователей, подтверждает блокировку, создаёт шаблон и видит аудит");

  await page.goto(base + "/"); await ready(page);
  await page.waitForFunction(() => window.__qaCalls.some(call => call[1] === "hit"));
  await page.getByRole("button", { name: "Настройки cookie", exact: true }).click();
  const unloadBefore = analyticsRequests.filter(request => request.url.endsWith("/unload")).length;
  await page.getByRole("button", { name: "Только необходимые", exact: true }).click();
  assert.equal(await page.locator("iframe.analytics-frame").count(), 0);
  await page.waitForTimeout(150);
  const afterWithdrawal = analyticsRequests.length;
  await page.waitForTimeout(550);
  assert.equal(analyticsRequests.length, afterWithdrawal);
  assert.equal(analyticsRequests.filter(request => request.url.endsWith("/unload")).length, unloadBefore);
  assert.equal((await context.request.get(base + "/analytics/frame")).status(), 403);
  await openScenario(page); await demo(page);
  assert.equal(analyticsRequests.length, afterWithdrawal);
  check("Отзыв согласия блокирует последующие запросы и unload-beacon; моделирование продолжает работать");

  const invalid = await page.goto(base + "/api/auth/oauth/yandex/callback?state=bad&code=DO_NOT_LOG_TEST_CODE");
  assert.equal(invalid.status(), 200);
  await page.getByRole("alert").filter({ hasText: "Ссылка входа истекла" }).waitFor();
  assert(!page.url().includes("DO_NOT_LOG_TEST_CODE"));
  for (const slug of ["legal", "offer", "privacy"]) {
    const response = await context.request.get(base + "/" + slug);
    const html = await response.text();
    assert.equal(response.status(), 200);
    assert(html.includes("Документ ещё не опубликован") && !html.includes("[ПОДТВЕРДИТЬ"));
    assert(html.includes(`https://app.example.test/${slug}`));
  }
  const robots = await (await context.request.get(base + "/robots.txt")).text();
  assert(robots.includes("Disallow: /admin") && robots.includes("Disallow: /account"));
  const sitemap = await (await context.request.get(base + "/sitemap.xml")).text();
  assert(sitemap.includes("https://app.example.test/") && !sitemap.includes("/admin") && !sitemap.includes("/account") && !sitemap.includes("/privacy"));
  check("Callback очищает URL; правовые ссылки не раскрывают черновики; canonical, robots и sitemap исключают закрытые разделы");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/admin");
  await page.locator(".admin-metrics").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "artifacts/services/admin-mobile.png" });
  await page.goto(base + "/register");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "artifacts/services/register-mobile.png" });
  check("Админка и регистрация помещаются на мобильном экране");
  assert.deepEqual(errors, []);
  await writeFile("artifacts/services-browser-check.json", JSON.stringify({ checks, errors, analytics: "SDK and requests intercepted locally; no real counter activated" }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) { await mkdir("artifacts/services", { recursive: true }); await page.screenshot({ path: "artifacts/services/failure.png" }).catch(() => {}); await writeFile("artifacts/services/failure.json", JSON.stringify({ url: page.url(), errors }, null, 2)); }
  throw error;
} finally {
  await browser.close();
}
