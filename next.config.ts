import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must not be bundled by Next.
  serverExternalPackages: ["better-sqlite3"],
  // Personal, single-user tool — never meant to be indexed. This header
  // covers every route (including API routes, which carry no <meta> tags);
  // robots.ts (disallow all) and the page-level robots metadata are the
  // other two layers of the same rule.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noimageindex" }],
      },
    ];
  },
};

export default nextConfig;
