import type { NextConfig } from 'next'
import bundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  transpilePackages: ['@supabase/supabase-js', '@supabase/ssr'],
  async redirects() {
    return [
      { source: '/profile', destination: '/settings', permanent: true },
    ]
  },
  experimental: {
    optimizePackageImports: ['recharts'],
    serverActions: {
      bodySizeLimit: '1024kb',
    },
  },
}

export default withBundleAnalyzer(nextConfig)
