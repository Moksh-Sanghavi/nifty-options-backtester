import type { NextConfig } from "next";

/**
 * The backend the Next server proxies API calls to. Defaults to the local
 * FastAPI dev server; override with BACKEND_ORIGIN when the backend lives
 * elsewhere. Routing through Next means the browser only ever talks to one
 * origin (this app), so a single tunnel/host exposes the whole stack and
 * there are no cross-origin (CORS) concerns.
 */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` },
    ];
  },
};

export default nextConfig;
