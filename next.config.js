// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Allows wallet popups (Coinbase, etc.) to work reliably
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // Optional: If you previously set COEP to a strict value, relax it.
          // If you don't use COEP at all, you can omit this line.
          { key: "Cross-Origin-Embedder-Policy", value: "unsafe-none" },
        ],
      },
    ];
  },
};

export default nextConfig;