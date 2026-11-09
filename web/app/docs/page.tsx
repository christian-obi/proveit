import type { Metadata } from "next";
import { docsHtml } from "@/lib/docs";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Docs · Prove-It",
  description: "How Prove-It works: verifiable private Hyperliquid trading cards on NEAR, the five checks, the API and what is and isn't proven.",
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs.md" } },
};

export default function DocsPage() {
  return (
    <>
      <p className="mb-6 text-sm text-muted">
        For AI agents: <a className="underline" href="/docs.md">this page as Markdown</a> · <a className="underline" href="/llms.txt">llms.txt</a>
      </p>
      <article className="docs" dangerouslySetInnerHTML={{ __html: docsHtml() }} />
    </>
  );
}
