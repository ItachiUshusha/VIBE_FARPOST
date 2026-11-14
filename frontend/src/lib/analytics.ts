export const ANALYTICS_PAGES: Record<string, string> = {
  "/": "Карта района", "/login": "Вход", "/register": "Регистрация", "/account": "Личный кабинет",
  "/legal": "Правовая информация", "/offer": "Публичная оферта", "/privacy": "Политика конфиденциальности",
  "/cookies": "Политика cookie", "/analytics-consent": "Согласие на аналитику",
};
export type Goal = "registration_success" | "login_success" | "simulation_success";
export type UtmAllowlist = Record<string, string[]>;
export function analyticsUrl(raw: string, origin: string, allowlist: UtmAllowlist): string | null {
  try {
    const input = new URL(raw, origin);
    if (input.origin !== origin || !ANALYTICS_PAGES[input.pathname]) return null;
    const clean = new URL(input.pathname, origin);
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      const value = input.searchParams.get(key);
      if (value && allowlist[key]?.includes(value) && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value)) clean.searchParams.set(key, value);
    }
    return clean.href;
  } catch { return null; }
}
export function safeReferrer(raw: string, origin: string): string {
  try { const url = new URL(raw); return url.origin === origin ? analyticsUrl(url.pathname, origin, {}) || "" : /^https?:$/.test(url.protocol) ? url.origin : ""; }
  catch { return ""; }
}
export function trackGoal(goal: Goal, method?: "local" | "yandex" | "vk") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("farpost:goal", { detail: { goal, method } }));
}
