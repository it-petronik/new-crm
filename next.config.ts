import type { NextConfig } from "next";
const config: NextConfig = {
  // No standalone output: the Cloudflare adapter produces its own bundle.
  poweredByHeader: false,
  async headers() {
    const headers = [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Voice notes and meetings use the microphone, meetings the camera
            // and screen sharing — from this site's own pages only; no
            // embedded frame or other origin may. Geolocation stays off.
            value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            // Deliberately no third-party scripts. Cloudflare
            // Web Analytics is not used by this app; the beacon seen in the
            // console (static.cloudflareinsights.com) is injected by the
            // zone's automatic Web Analytics setting and is correctly blocked
            // here. Turn that injection off in the Cloudflare dashboard rather
            // than widening this policy. The only third-party connections are
            // the meeting provider's own origins (LiveKit Cloud signalling
            // and region discovery); media flows over WebRTC, not fetch.
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' blob:; font-src 'self'; connect-src 'self' wss://crm.enercore.ae wss://*.livekit.cloud https://*.livekit.cloud; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ];
    // The authenticated mail renderer supplies a stricter, no-script frame CSP.
    // Do not inherit the app's image prohibition into approved email images.
    return [
      {source:"/(.*)",headers:headers.filter(h=>!["Content-Security-Policy","X-Frame-Options"].includes(h.key))},
      {source:"/((?!api/mail/render).*)",headers:headers.filter(h=>["Content-Security-Policy","X-Frame-Options"].includes(h.key))},
    ];
  },
};
export default config;
