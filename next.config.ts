import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
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
