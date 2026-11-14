"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native modality keeps the map, navigation and footer inert, including on desktop. */
export default function AppDialog({ open, onClose, label, className = "", children }: {
  open: boolean; onClose: () => void; label: string; className?: string; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const gesture = useRef<{ x: number; y: number; handle: boolean; outside: boolean } | null>(null);
  const id = useId();
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      if (history.state?.fpOverlay === id) history.back();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    // Reuse the entry during React Strict Mode's effect replay.
    if (history.state?.fpOverlay !== id) history.pushState({ ...history.state, fpOverlay: id }, "", location.href);
    const back = () => { if (history.state?.fpOverlay !== id) close.current(); };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      element.close();
      requestAnimationFrame(() => {
        const candidates = [previous, ...document.querySelectorAll<HTMLElement>(".mobile-tabbar button.active, .mobile-actions-trigger:not([hidden]), .desktop-map-actions button:not(:disabled)")];
        const target = candidates.find(element => element?.isConnected && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
        target?.focus({ preventScroll: true });
      });
    };
  }, [open, id]);
  return <dialog ref={dialog} className={`app-dialog ${className}`} aria-label={label}
    onCancel={event => { event.preventDefault(); close.current(); }}
    onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onPointerDown={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const handle = !!(event.target as HTMLElement).closest("[data-sheet-handle]") && !(event.target as HTMLElement).closest("button, input, select, a");
      gesture.current = { x: event.clientX, y: event.clientY, handle,
        outside: event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom };
      if (handle) event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={event => {
      const start = gesture.current;
      gesture.current = null;
      if (!start) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if ((start.outside && outside) || (start.handle && event.clientY - start.y > 80 && Math.abs(event.clientX - start.x) < 80)) close.current();
    }}>
    {children}
  </dialog>;
}
