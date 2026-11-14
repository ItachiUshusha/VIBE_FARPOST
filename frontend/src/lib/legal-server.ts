import "server-only";
import { indexingEnabled, publicOrigin } from "./server-config";
export const LEGAL_TITLES = { legal: "Правовая информация", offer: "Публичная оферта", privacy: "Политика конфиденциальности", cookies: "Политика cookie", "analytics-consent": "Согласие на аналитику" };
export type LegalSlug = keyof typeof LEGAL_TITLES;
type Document = { published: boolean; title: string; text?: string; version?: string; unavailable?: boolean };
export async function legalDocument(slug: LegalSlug): Promise<Document> {
  try {
    const response = await fetch(`${process.env.API_PROXY_URL || "http://127.0.0.1:8000"}/api/legal/${slug}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (response.ok) return await response.json();
  } catch {}
  return { published: false, title: LEGAL_TITLES[slug], unavailable: true };
}
export async function legalMetadata(slug: LegalSlug) {
  const document = await legalDocument(slug);
  return { title: `${document.title} — 402x402`, alternates: { canonical: `${publicOrigin()}/${slug}` }, robots: { index: document.published && indexingEnabled(), follow: document.published && indexingEnabled() } };
}
