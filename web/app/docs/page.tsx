import type { Metadata } from "next";
import DocsPage from "@/components/DocsPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Docs · Prove-It",
  description: "How Prove-It works: verifiable private Hyperliquid trading cards on NEAR, the five checks, the API and what is and isn't proven.",
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs.md" } },
};

export default function Page() {
  return <DocsPage slug="" />;
}
