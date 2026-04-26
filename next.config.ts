import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Workspace package — mcp-server uses .js-extension imports (Node ESM
  // standard for the published stdio binary). Turbopack won't auto-resolve
  // those to .ts source files unless we mark the package as "transpile from
  // source," so the /api/mcp route can import the same factory the stdio
  // binary uses without needing a prebuild step.
  transpilePackages: ["@onegent/mcp-server"],
  // Suppress verbose fetch/request logs in dev (SSE stream hits flood the terminal)
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "places.googleapis.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
