import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @reputation/shared-types (packages/shared-types) ships raw .ts with no
  // build step — this tells Next's compiler to transpile it like local app
  // code instead of treating it as pre-built node_modules code.
  transpilePackages: ["@reputation/shared-types"],
};

export default nextConfig;
