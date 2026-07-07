/** @type {import('next').NextConfig} */
const nextConfig = {
  // The UI talks to the Cookmate engine API (Hono server) at NEXT_PUBLIC_API_BASE.
  // Keeping the engine as a standalone service avoids bundling Node-only SDKs into
  // the Next build; it can be folded into route handlers later.
  reactStrictMode: true,
  env: {
    // On Vercel builds, default the API base to the deployed engine so the app
    // works even if the dashboard env var is missing/mis-scoped. Local dev is
    // untouched (falls back to http://localhost:8787 in lib/api.ts).
    ...(process.env.VERCEL && !process.env.NEXT_PUBLIC_API_BASE
      ? { NEXT_PUBLIC_API_BASE: 'https://cookmate-api.onrender.com' }
      : {}),
  },
};

export default nextConfig;
