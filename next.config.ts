
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
      maxDuration: 120,
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Cache-busting: HTML pages are never cached so users always get the
  // latest bundle references. Static assets (JS/CSS) are cached for 1 year
  // because Next.js already appends a content hash to their filenames.
  async headers() {
    return [
      {
        // Never cache HTML pages — forces browser to always fetch fresh HTML
        // which then references the latest hashed JS/CSS bundles.
        source: '/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
      {
        // Aggressively cache static assets — they are safe because Next.js
        // builds unique content-hashed filenames on every deploy.
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  webpack: (
    config,
    { isServer }
  ) => {
    if (isServer) {
      config.externals.push('handlebars');
    }

    return config
  },
};

export default nextConfig;
