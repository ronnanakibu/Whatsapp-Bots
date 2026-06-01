import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Allow images from any domain (album art thumbnails)
  images: {
    unoptimized: true, // Required for static export with external images
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  // Environment variables exposed to browser
  env: {
    // Relative URL ensures it always points to the host serving the file!
    NEXT_PUBLIC_RADIO_URL: process.env.NEXT_PUBLIC_RADIO_URL || '',
  },
};

export default nextConfig;
