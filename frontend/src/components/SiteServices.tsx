"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ANALYTICS_PAGES, analyticsUrl, safeReferrer, type UtmAllowlist } from "@/lib/analytics";

type Config = { metrica_counter_id: string; utm_allowlist: UtmAllowlist; legal_published: boolean; legal_version: string };
type Consent = { analytics: boolean; updated_at: number; version: 2; legal_version: string };
const STORAGE = "fp_consent_v1";
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const ConsentContext = createContext({ resolved: false, analytics: false });
export const useConsent = () => useContext(ConsentContext);
function disableFrame(node: HTMLIFrameElement | null) {
  try { (node?.contentWindow as (Window & { __disableAnalytics?: () => void }) | null)?.__disableAnalytics?.(); } catch {}
}

function readConsent(): Consent | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || "null");
    return value?.version === 2 && typeof value.analytics === "boolean" && typeof value.legal_version === "string" && typeof value.updated_at === "number" && value.updated_at <= Date.now() && Date.now() - value.updated_at < 180 * 86400000 ? value : null;
  } catch { return null; }
}
function clearAnalyticsStorage() {
  const domains = ["", location.hostname, "." + location.hostname];
  for (const item of document.cookie.split(";")) {
    const name = item.trim().split("=")[0];
    if (!/^_ym_/.test(name)) continue;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
  }
  try { for (const key of Object.keys(localStorage)) if (/^_ym_/.test(key)) localStorage.removeItem(key); } catch {}
}
function consentCookie(analytics: boolean) {
  document.cookie = `fp_analytics=${analytics ? "accepted" : "necessary"}; Path=/; Max-Age=15552000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export default function SiteServices({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [resolved, setResolved] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [configRetry, setConfigRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const attachFrame = useCallback((node: HTMLIFrameElement | null) => { if (frame.current && frame.current !== node) disableFrame(frame.current); frame.current = node; }, []);
  const frameReady = useRef(false);
  const queue = useRef<object[]>([]);
  const latest = useRef({ permitted: false });
  const validConsent = consent && consent.legal_version === (config?.legal_version || "") ? consent : null;
  const enabled = resolved && !!validConsent?.analytics && !!config?.legal_published && !!config?.metrica_counter_id && !!ANALYTICS_PAGES[path];
  useBrowserLayoutEffect(() => { latest.current.permitted = enabled; }, [enabled]);
  const previousUrl = useRef("");
  const lastView = useRef("");

  useEffect(() => {
    // Browser storage is intentionally hydrated after SSR; no analytics exists before resolution.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const stored = readConsent(); consentCookie(false); setConsent(stored); setResolved(true);
    const storage = (event: StorageEvent) => { if (event.key === STORAGE) { latest.current.permitted = false; queue.current = []; frameReady.current = false; flushSync(() => setConsent(readConsent())); } };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch("/api/site/config", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Configuration unavailable");
      const value: Config = await response.json();
      if (typeof value.legal_published !== "boolean" || typeof value.legal_version !== "string" || (value.legal_published && !value.legal_version)) throw new Error("Invalid configuration");
      if (!active) return;
      setConfig(value); setConfigError(false);
      const current = readConsent();
      consentCookie(value.legal_published && current?.legal_version === value.legal_version && !!current?.analytics);
    }).catch(() => {
      if (!active) return;
      setConfig(null); setConfigError(true); consentCookie(false);
    }).finally(() => {
      clearTimeout(timeout);
      if (active) setConfigLoading(false);
    });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [configRetry]);

  useEffect(() => {
    const send = (message: object) => {
      if (!latest.current.permitted) return;
      if (frameReady.current) frame.current?.contentWindow?.postMessage(message, location.origin);
      else queue.current = [...queue.current.slice(-19), message];
    };
    const goal = (event: Event) => {
      const { goal: name, method } = (event as CustomEvent).detail || {};
      if (!["registration_success", "login_success", "simulation_success"].includes(name)) return;
      send({ type: "goal", name, method: ["local", "yandex", "vk"].includes(method) ? method : undefined });
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "analytics-ready" || !latest.current.permitted) return;
      frameReady.current = true;
      for (const item of queue.current) frame.current?.contentWindow?.postMessage(item, location.origin);
      queue.current = [];
    };
    window.addEventListener("farpost:goal", goal); window.addEventListener("message", message);
    return () => { window.removeEventListener("farpost:goal", goal); window.removeEventListener("message", message); };
  }, []);

  useEffect(() => {
    if (!enabled || !config) { frameReady.current = false; queue.current = []; lastView.current = ""; return; }
    const url = analyticsUrl(location.href, location.origin, config.utm_allowlist);
    if (!url || lastView.current === url) return;
    lastView.current = url;
    const message = { type: "view", url, title: ANALYTICS_PAGES[path], referer: previousUrl.current || safeReferrer(document.referrer, location.origin) };
    previousUrl.current = url;
    if (frameReady.current) frame.current?.contentWindow?.postMessage(message, location.origin);
    else queue.current.push(message);
  }, [enabled, path, config, consent?.updated_at]);

  const choose = (analytics: boolean) => {
    if (analytics && !config?.legal_published) return;
    const value: Consent = { analytics, updated_at: Date.now(), version: 2, legal_version: config?.legal_version || "" };
    latest.current.permitted = false; queue.current = []; frameReady.current = false; lastView.current = "";
    if (!analytics) disableFrame(frame.current);
    consentCookie(analytics);
    flushSync(() => { setConsent(value); setSettingsOpen(false); });
    try { localStorage.setItem(STORAGE, JSON.stringify(value)); } catch {}
    if (!analytics) clearAnalyticsStorage();
  };
  return <ConsentContext.Provider value={{ resolved: resolved && !!config, analytics: !!validConsent?.analytics && !!config?.legal_published }}>
    {children}
    <footer className={`site-footer${path === "/" ? " is-map" : ""}`}>
      <Link href="/legal">Правовая информация</Link><Link href="/offer">Оферта</Link><Link href="/privacy">Конфиденциальность</Link><Link href="/cookies">Политика cookie</Link>
      <button onClick={() => setSettingsOpen(true)}>Настройки cookie</button>
    </footer>
    {resolved && (!validConsent || settingsOpen) && <section className="cookie-banner" aria-label="Настройки cookie">
      <div><strong>Cookie и конфиденциальность</strong><p>Необходимые cookie обеспечивают вход и безопасность. Нажимая «Принять», вы даёте Игнату Алексеевичу <Link href="/analytics-consent">отдельное согласие на аналитику Яндекс Метрики</Link> на 180 дней. Выбор можно изменить здесь в любое время. <Link href="/cookies">О cookie</Link></p>
        {configLoading && <p role="status">Загружаем настройки cookie…</p>}
        {configError && <p role="status">Не удалось загрузить настройки. <button type="button" className="service-link" onClick={() => { setConfigError(false); setConfigLoading(true); setConfigRetry(value => value + 1); }}>Повторить</button></p>}
        {config && !config.legal_published && <p>Согласие на аналитику станет доступно после публикации документов. Можно продолжить с необходимыми cookie.</p>}
      </div>
      <div className="cookie-actions"><button className="service-button secondary" onClick={() => choose(false)}>Только необходимые</button><button className="service-button" disabled={configLoading || !config?.legal_published} onClick={() => choose(true)}>Принять</button></div>
    </section>}
    {enabled && <iframe key={consent?.updated_at} ref={attachFrame} src="/analytics/frame" title="Аналитика" aria-hidden="true" tabIndex={-1} className="analytics-frame" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />}
  </ConsentContext.Provider>;
}
