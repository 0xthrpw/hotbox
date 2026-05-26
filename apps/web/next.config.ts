import type { NextConfig } from 'next';
import { join } from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@hotbox/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.HOTBOX_API_URL ?? 'http://127.0.0.1:3000'}/api/:path*`,
      },
    ];
  },
};

export default config;
