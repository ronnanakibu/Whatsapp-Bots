import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Output standalone untuk di-serve Express dari bot
  output: 'standalone',

  // Base path kalau mau serve di subdirectory: /dashboard
  // Uncomment kalau pakai port yang sama dengan radio
  // basePath: '/dashboard',

  // Image domains untuk album art / thumbnails
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'i1.sndcdn.com' },
      { protocol: 'https', hostname: 'i2.sndcdn.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
    ],
  },

  // Webpack config untuk GSAP
  webpack: (config) => {
    config.externals = config.externals || []
    return config
  },
}

export default nextConfig