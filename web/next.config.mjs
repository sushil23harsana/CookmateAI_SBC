/** @type {import('next').NextConfig} */
const nextConfig = {
  // The UI talks to the Cookmate engine API (Hono server) at NEXT_PUBLIC_API_BASE.
  // Keeping the engine as a standalone service avoids bundling Node-only SDKs into
  // the Next build; it can be folded into route handlers later.
  reactStrictMode: true,
};

export default nextConfig;
