import type { NextConfig } from "next";
const config: NextConfig = {
  // No standalone output: the Cloudflare adapter produces its own bundle.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Voice notes record from this site's own pages; no embedded frame
            // or other origin may use the microphone, and camera/geolocation
            // stay off entirely.
            value: "camera=(), microphone=(self), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            // Deliberately no third-party script or connect origins. Cloudflare
            // Web Analytics is not used by this app; the beacon seen in the
            // console (static.cloudflareinsights.com) is injected by the
            // zone's automatic Web Analytics setting and is correctly blocked
            // here. Turn that injection off in the Cloudflare dashboard rather
            // than widening this policy.
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' wss://crm.enercore.ae; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
