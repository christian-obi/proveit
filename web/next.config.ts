import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // packages/verify ships TypeScript source; the browser runs the same checks as the CLI.
  transpilePackages: ["@proveit/verify"],
  // Any docs page as Markdown: add .md to its URL, as on GitBook.
  rewrites: async () => [{ source: "/docs/:path(.+\\.md)", destination: "/docs-raw/:path" }],
};

export default config;
