import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify supplies the canonical URL during builds. Only public origin/access
  // settings are embedded; database configuration and secrets stay on the server.
  env: {
    ...(process.env.URL || process.env.SITE_ORIGIN
      ? { SITE_ORIGIN: new URL(process.env.SITE_ORIGIN || process.env.URL!).origin }
      : {}),
    ...(process.env.ALLOWED_EMAILS ? { ALLOWED_EMAILS: process.env.ALLOWED_EMAILS } : {}),
  },
};

export default nextConfig;
