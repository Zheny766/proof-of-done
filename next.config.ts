import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep demo recordings and screenshots clean.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Milestone links carry a key until the page drops it; never send it to other sites.
          { key: 'Referrer-Policy', value: 'same-origin' },
          // No framing: nobody can overlay "Approve & pay" inside their own page.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Browsers only honour this over HTTPS, so it's harmless on localhost.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
