import type { NextConfig } from "next";

/*
 * AEGIS-004: baseline security response headers.
 *
 * The Content-Security-Policy is deliberately shipped in Report-Only mode.
 * Aurora embeds the YouTube iframe player and loads TMDB imagery, and Next.js
 * injects inline bootstrap scripts, so an enforcing policy risks breaking
 * playback. Observe violation reports first, then switch the header name to
 * "Content-Security-Policy" once the policy is confirmed clean.
 *
 * 'unsafe-inline' on script-src is required by the Next.js runtime unless a
 * nonce-based middleware is introduced; tightening that is tracked separately
 * and intentionally out of scope for this minimal change.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://image.tmdb.org https://i.ytimg.com",
  "media-src 'self' blob:",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "connect-src 'self' https://api.themoviedb.org https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    /*
     * Only meaningful over HTTPS; browsers ignore it on plain HTTP, so it is
     * safe to send from local development too. Not preloaded deliberately —
     * preloading is difficult to reverse and needs an explicit decision.
     */
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        port: "",
        pathname: "/t/p/**",
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
