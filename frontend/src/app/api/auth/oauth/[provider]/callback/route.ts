import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const errorResponse = () => new Response(null, { status: 303, headers: { Location: "/login?error=provider", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
  if (!["yandex", "vk"].includes(provider) || request.nextUrl.search.length > 8192) return errorResponse();
  const destination = new URL(`/api/auth/oauth/${provider}/callback`, process.env.API_PROXY_URL || "http://127.0.0.1:8000");
  for (const key of ["code", "state", "device_id", "error"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) destination.searchParams.set(key, value);
  }
  try {
    const upstream = await fetch(destination, { headers: { Cookie: request.headers.get("cookie") || "" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000) });
    const location = upstream.headers.get("location");
    if (upstream.status !== 303 || !location || !/^\/(account|login)(\?|$)/.test(location)) return errorResponse();
    const response = new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
    for (const cookie of upstream.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch {
    // Deliberately do not log the request URL: it contains a short-lived authorization code.
    return errorResponse();
  }
}
