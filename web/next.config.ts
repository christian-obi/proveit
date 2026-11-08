import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // packages/verify ships TypeScript source; the browser runs the same checks as the CLI.
  transpilePackages: ["@proveit/verify"],
};

export default config;
