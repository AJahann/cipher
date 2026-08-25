import type { NextConfig } from 'next';

try {
  process.loadEnvFile('../../.env');
} catch {
  // file not found — rely on process.env / apps/web/.env.local
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@chat-app/shared'],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
