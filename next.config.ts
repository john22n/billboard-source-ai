import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb'
    }
  },
  // ✅ Add empty turbopack config to silence the warning
  turbopack: {
    root: process.cwd(),
  },
  // Exclude server-side packages from client bundle
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle these Node.js modules in client-side code
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
}

export default nextConfig;