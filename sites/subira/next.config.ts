import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  turbopack: { root: __dirname },
};

export default config;
