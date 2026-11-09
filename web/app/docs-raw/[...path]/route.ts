// Each docs page as plain Markdown. next.config rewrites /docs/<page>.md here.

import { docPage, markdownResponse } from "@/lib/docs";

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const slug = (await params).path.map(decodeURIComponent).join("/").replace(/\.md$/, "");
  const page = docPage(slug === "README" ? "" : slug);
  return page ? markdownResponse(page.markdown) : new Response("Not found\n", { status: 404 });
}
