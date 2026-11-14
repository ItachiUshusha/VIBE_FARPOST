import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" }] },
      ...["/admin/:path*", "/account/:path*", "/login", "/register", "/analytics/:path*"].map(source => ({ source, headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store, private" },
      ] })),
    ];
  },
  async rewrites() {
    return { fallback: [{ source: "/api/:path*", destination: `${process.env.API_PROXY_URL || "http://127.0.0.1:8000"}/api/:path*` }] };
  },
};

export default nextConfig;
