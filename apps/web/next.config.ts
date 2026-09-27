import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@breakpoint/core", "@breakpoint/scenario"],
  serverExternalPackages: [
    "@safe-global/safe-smart-account",
    "@nomicfoundation/edr",
    "@nomicfoundation/edr-win32-x64-msvc"
  ]
};

export default nextConfig;
