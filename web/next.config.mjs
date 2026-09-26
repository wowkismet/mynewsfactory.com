/** @type {import('next').NextConfig} */

// Security headers applied to every response (Part LXXVI).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Content-Security-Policy is NOT here. It needs a fresh nonce per request,
  // which a static config cannot produce -- see src/middleware.ts. The static
  // version of this header blocked the framework's own scripts and stopped
  // React hydrating; a header that cannot vary per request must not try to
  // express a policy that has to.
]

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emits .next/standalone with a self-contained server.js, so the runtime
  // image carries only the files the server actually needs.
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
