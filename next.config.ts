import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    // wwxd is self-hosted; "/" goes straight to the app. The marketing
    // landing lives in its own repo (deploys to wwxd.chat).
    return [{ source: "/", destination: "/app", permanent: false }];
  },
};

export default nextConfig;
