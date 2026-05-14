import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@chat-app/shared'],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
