import { docsMarkdown, markdownResponse } from "@/lib/docs";

export const dynamic = "force-static";

export const GET = () => markdownResponse(docsMarkdown());
