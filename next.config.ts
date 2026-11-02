import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-img-convert', '@napi-rs/canvas'],
  devIndicators: false,
};

export default nextConfig;
