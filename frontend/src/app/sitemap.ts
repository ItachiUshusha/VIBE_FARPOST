import type { MetadataRoute } from "next";
import { indexingEnabled, publicOrigin } from "@/lib/server-config";
import { legalDocument, type LegalSlug } from "@/lib/legal-server";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingEnabled()) return [];
  const result: MetadataRoute.Sitemap = [{ url: publicOrigin() + "/", changeFrequency: "weekly", priority: 1 }];
  for (const slug of ["legal", "offer", "privacy"] as LegalSlug[]) if ((await legalDocument(slug)).published) result.push({ url: `${publicOrigin()}/${slug}`, changeFrequency: "yearly", priority: .2 });
  return result;
}
