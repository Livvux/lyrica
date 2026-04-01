import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  serverExternalPackages: [
    "remotion",
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/cli",
    "esbuild",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
