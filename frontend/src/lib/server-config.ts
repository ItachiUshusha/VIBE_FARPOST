import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "./account-api";

export function publicOrigin() {
  const value = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid PUBLIC_ORIGIN");
  return url.origin;
}
export function indexingEnabled() { return process.env.SEO_INDEXING_ENABLED === "true" && publicOrigin().startsWith("https://"); }
export async function serverIdentity(admin = false): Promise<User | null> {
  const token = (await cookies()).get("fp_session")?.value;
  if (!token) { redirect("/login"); }
  const response = await fetch(`${process.env.API_PROXY_URL || "http://127.0.0.1:8000"}/api/${admin ? "admin/guard" : "auth/me"}`, {
    headers: { Cookie: `fp_session=${encodeURIComponent(token)}` }, cache: "no-store", signal: AbortSignal.timeout(6000),
  });
  if (response.status === 401) redirect("/login");
  if (response.status === 403) return null;
  if (!response.ok) throw new Error("Аккаунт временно недоступен");
  const data = await response.json();
  if (!data.user) redirect("/login");
  return data.user;
}
