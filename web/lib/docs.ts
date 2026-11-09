// The docs have one source, content/docs.md, served as HTML at /docs and as Markdown at
// /docs.md and /llms-full.txt for AI readers. Read at build time (the routes are static).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";

export const docsMarkdown = () => readFileSync(join(process.cwd(), "content/docs.md"), "utf8");

export const slug = (text: string) =>
  text.toLowerCase().replace(/<[^>]+>|[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-");

const marked = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${slug(inner)}">${inner}</h${depth}>\n`;
    },
  },
});

/** Our own content, so the HTML is trusted. Wide tables scroll inside a keyboard-focusable box. */
export const docsHtml = () =>
  (marked.parse(docsMarkdown()) as string)
    .replaceAll("<table>", '<div class="docs-table" tabindex="0" role="region" aria-label="Scrollable table"><table>')
    .replaceAll("</table>", "</table></div>");

export const markdownResponse = (body: string, type = "text/markdown") =>
  new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Access-Control-Allow-Origin": "*" } });
