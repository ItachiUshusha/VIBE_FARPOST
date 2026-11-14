import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./services.css";
import "./mobile-ux.css";
import SiteServices from "@/components/SiteServices";
import { indexingEnabled, publicOrigin } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export function generateMetadata(): Metadata { return {
  metadataBase: new URL(publicOrigin()),
  title: "Эффект бабочки — Первая Речка",
  description: "Одно перекрытие меняет весь район. Исследуйте дорожные сценарии Первой Речки во Владивостоке.",
  icons: { icon: "/icon.svg" },
  robots: { index: indexingEnabled(), follow: indexingEnabled() },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined, yandex: process.env.YANDEX_SITE_VERIFICATION || undefined },
}; }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><SiteServices>{children}</SiteServices></body></html>;
}
