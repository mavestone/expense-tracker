import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "archiver"],
  // Ensure migration SQL ships with the serverless bundle so runtime
  // migration works on Vercel as well as locally.
  outputFileTracingIncludes: {
    "/": ["./drizzle/**/*"],
    "/api/**/*": ["./drizzle/**/*"],
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
