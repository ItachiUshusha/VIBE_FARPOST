"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
    <App name="402x402" theme="ios" darkMode="auto" clicks={{ externalLinks: "a" }} className="design-app">{children}</App>
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
      document.documentElement.dataset.keyboardOpen = String(innerHeight - height > 120 && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || ""));
    };
    update(); viewport?.addEventListener("resize", update); viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("focusin", update); window.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update);
      window.removeEventListener("focusin", update); window.removeEventListener("focusout", update);
      delete document.documentElement.dataset.keyboardOpen;
      document.documentElement.style.removeProperty("--keyboard-gap");
      document.documentElement.style.removeProperty("--visual-height");
    };
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

export function AdaptiveSheet({ children, className, open, mobile, onClose, label = "Панель эксперимента" }: {
  children: ReactNode; className: string; open: boolean; mobile: boolean; onClose: () => void; label?: string;
}) {
  const reduced = useReducedMotion();
  const latest = useRef({ open, mobile, onClose });
  useEffect(() => { latest.current = { open, mobile, onClose }; }, [open, mobile, onClose]);
  return <Sheet className={`${className}${open ? " is-active" : ""}`} opened={mobile && open} animate={!reduced} containerEl=".app-shell"
    backdrop={false} closeByBackdropClick={false} closeByOutsideClick={false} closeOnEscape swipeToClose
    swipeHandler={`.${className} .panel-navigation, .${className} .sheet-drag-zone`} breakpoints={[]}
    onSheetClosed={() => { if (latest.current.open && latest.current.mobile) latest.current.onClose(); }}>
    <div className="sheet-surface" role="region" aria-label={label}>{children}</div>
  </Sheet>;
}

export function MapSkeleton({ failed = false, message = "Подключаем модель района" }: { failed?: boolean; message?: string }) {
  return <div className={`map-placeholder map-skeleton${failed ? " failed" : ""}`}>
    <svg className="skeleton-streets" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M-100 490 390 335 1100 35M200-100 420 335 570 800M-100 130 320 195 660 450 1100 500M660-100 660 240 850 800M-100 660 470 520 1100 300" /></svg>
    <div className="map-skeleton-status" role="status">{!failed && <AppPreloader />}<span>{message}</span></div>
  </div>;
}
