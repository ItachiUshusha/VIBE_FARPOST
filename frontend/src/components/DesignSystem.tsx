"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Framework7 from "framework7/lite";
import SheetModule from "framework7/components/sheet";
import ToastModule from "framework7/components/toast";
import PreloaderModule from "framework7/components/preloader";
import Framework7React, { App, Sheet, Toolbar, Preloader, f7 } from "framework7-react";
import { domAnimation, LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import { onCLS, onINP, onLCP } from "web-vitals";

// eslint-disable-next-line react-hooks/rules-of-hooks -- Framework7.use registers plugins; it is not a React hook.
Framework7.use([Framework7React, SheetModule, ToastModule, PreloaderModule]);

declare global {
  interface Window { __farpostVitals?: Record<string, number>; }
}

export function DesignProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const report = (metric: { name: string; value: number }) => {
      window.__farpostVitals = { ...window.__farpostVitals, [metric.name]: metric.value };
    };
    onCLS(report, { reportAllChanges: true });
    onLCP(report, { reportAllChanges: true });
    onINP(report, { reportAllChanges: true });
  }, []);
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict>
    <App name="Эффект бабочки" theme="ios" darkMode="auto" clicks={{ externalLinks: "a" }} className="design-app">{children}</App>
  </LazyMotion></MotionConfig>;
}

export function useAppEnvironment() {
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const media = matchMedia("(max-width: 900px), (max-height: 560px) and (max-width: 1100px)");
    const update = () => setMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const value = theme === "system" ? media.matches : theme === "dark";
      setDark(value);
      document.documentElement.dataset.theme = theme;
      f7?.setDarkMode(value);
    };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height || innerHeight;
      document.documentElement.style.setProperty("--visual-height", `${height}px`);
      document.documentElement.style.setProperty("--keyboard-gap", `${Math.max(0, innerHeight - height - (viewport?.offsetTop || 0))}px`);
    };
    update(); viewport?.addEventListener("resize", update); viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => { viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  return { mobile, dark, reducedMotion: !!reducedMotion, theme, toggleTheme: () => setTheme(dark ? "light" : "dark") };
}

export function AppPreloader({ small = false }: { small?: boolean }) {
  return <Preloader className={small ? "app-preloader small" : "app-preloader"} />;
}

export { Toolbar as MobileToolbar };

export function notify(text: string) {
  if (f7?.toast) f7.toast.create({ text, position: "top", closeTimeout: 2300, destroyOnClose: true, cssClass: "app-toast" }).open();
}

export function expandSheet(selector = ".control-sheet") { f7?.sheet?.get(selector)?.setBreakpoint(1); }

export function AdaptiveSheet({ children, className, open, mobile, onClose, modal = false }: {
  children: ReactNode; className: string; open: boolean; mobile: boolean; onClose: () => void; modal?: boolean;
}) {
  const reduced = useReducedMotion();
  const [breakpoint, setBreakpoint] = useState(1);
  const onBreakpoint = useCallback((_instance: unknown, value: number) => setBreakpoint(value), []);
  const latest = useRef({ open, mobile, onClose }); latest.current = { open, mobile, onClose };
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobile || !open || modal) return;
    const fitShortScreen = () => { if (innerHeight < 560) expandSheet(`.${className}`); };
    fitShortScreen(); window.addEventListener("resize", fitShortScreen);
    return () => window.removeEventListener("resize", fitShortScreen);
  }, [mobile, open, modal, className]);
  useEffect(() => {
    if (!open || !mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    if (modal) surface.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !modal || !surface.current) return;
      const items = [...surface.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.offsetParent !== null);
      const first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected && (document.activeElement === document.body || surface.current?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [open, mobile, modal]);
  return <Sheet className={`${className}${open ? " is-active" : ""}${breakpoint > 0 && breakpoint < 1 ? " sheet-partial" : ""}${breakpoint > 0 && breakpoint < .5 ? " sheet-compact" : ""}`} opened={mobile && open} animate={!reduced} containerEl=".app-shell"
    backdrop={modal} closeByBackdropClick={modal} closeByOutsideClick={false} closeOnEscape swipeToClose
    swipeHandler={`.${className} .sheet-drag-zone`} breakpoints={modal ? [] : [.36, .7]}
    onSheetOpen={instance => { instance?.off("breakpoint", onBreakpoint); instance?.on("breakpoint", onBreakpoint); if (!modal && latest.current.mobile) instance?.setBreakpoint(innerHeight < 560 ? 1 : .7); }}
    onSheetClosed={() => { setBreakpoint(1); if (latest.current.open && latest.current.mobile) latest.current.onClose(); }}>
    <div ref={surface} className="sheet-surface" role={modal && mobile ? "dialog" : "region"} aria-modal={modal && mobile ? true : undefined}
      aria-label={modal ? "Редактор дома" : "Панель эксперимента"} tabIndex={-1}
      onFocusCapture={event => { if (mobile && /INPUT|SELECT|TEXTAREA/.test((event.target as HTMLElement).tagName)) expandSheet(`.${className}`); }}>
      {children}
      {!modal && <span className="compact-sheet-hint">Потяните вверх или нажмите на захват</span>}
    </div>
  </Sheet>;
}

export function MapSkeleton({ failed = false, message = "Подключаем модель района" }: { failed?: boolean; message?: string }) {
  return <div className={`map-placeholder map-skeleton${failed ? " failed" : ""}`}>
    <svg className="skeleton-streets" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M-100 490 390 335 1100 35M200-100 420 335 570 800M-100 130 320 195 660 450 1100 500M660-100 660 240 850 800M-100 660 470 520 1100 300" /></svg>
    <div className="map-skeleton-status" role="status">{!failed && <AppPreloader />}<span>{message}</span></div>
  </div>;
}
