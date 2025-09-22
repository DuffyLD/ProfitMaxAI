// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Allow Shopify Admin to embed your app in an iframe
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Shopify Admin loads your app in an iframe. This allows that.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
          },
          // Some hosts set X-Frame-Options by default; this makes sure it won't block embedding.
          { key: "X-Frame-Options", value: "ALLOWALL" },
        ],
      },
    ];
  },
};

export default nextConfig;