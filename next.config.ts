import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.gametools.network',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.gametools.network',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.ea.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
