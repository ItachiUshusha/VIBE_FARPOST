import type { MetadataRoute } from "next";
import { indexingEnabled, publicOrigin } from "@/lib/server-config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled()) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/api/", "/analytics/", "/login", "/register"] }, sitemap: publicOrigin() + "/sitemap.xml" };
}
