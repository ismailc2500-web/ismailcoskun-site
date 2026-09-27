import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: { position: "bottom-right" },
  // Native modules must stay outside the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Generated media lives on disk and is served through /api/files, so keep
  // the file watcher away from those folders.
  outputFileTracingExcludes: {
    "*": ["./output/**", "./cache/**", "./data/studio.db*"],
  },
};

export default nextConfig;
