/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Container-friendly build (Dockerfile copies .next/standalone). Vercel/Netlify ignore it.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  webpack(config) {
    // pdf.js has an optional Node-only dependency that must not be bundled for the browser.
    config.resolve.alias = { ...(config.resolve.alias ?? {}), canvas: false };
    config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false, path: false, zlib: false, http: false, https: false, url: false };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
