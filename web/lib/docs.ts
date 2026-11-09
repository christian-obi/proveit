// The docs live in content/docs in GitBook's format (README.md, SUMMARY.md, one file per page;
// see /.gitbook.yaml). This site serves each page as HTML at /docs/<page> and Markdown at
// /docs/<page>.md, and everything joined at /docs.md and /llms-full.txt for AI readers.

import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { Marked, type Tokens } from "marked";

const ROOT = join(process.cwd(), "content/docs");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

export type DocEntry = { title: string; file: string; slug: string; href: string; markdownHref: string; group: string };

const slugOf = (file: string) => (file === "README.md" ? "" : file.replace(/\.md$/, ""));
const hrefOf = (s: string) => (s ? `/docs/${s}` : "/docs");

/** The page tree from SUMMARY.md, in reading order. */
export function docPages(): DocEntry[] {
  const pages: DocEntry[] = [];
  let group = "";
  for (const line of read("SUMMARY.md").split("\n")) {
    const heading = line.match(/^## (.+)$/);
    if (heading) group = heading[1].trim();
    const link = line.match(/^\s*[*-] \[(.+?)\]\((.+?\.md)\)/);
    if (!link) continue;
    const [, title, file] = link;
    const s = slugOf(file);
    pages.push({ title, file, slug: s, href: hrefOf(s), markdownHref: s ? `/docs/${s}.md` : "/docs/README.md", group });
  }
  return pages;
}

export const slug = (text: string) =>
  text.toLowerCase().replace(/<[^>]+>|[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-");

function render(markdown: string, file: string) {
  const toc: { id: string; text: string }[] = [];
  const marked = new Marked({
    walkTokens(token) {
      // GitBook links between pages by relative file path; here they're routes.
      if (token.type !== "link") return;
      const link = token as Tokens.Link;
      const [path, hash] = link.href.split("#");
      if (/^[a-z]+:/i.test(link.href) || !path.endsWith(".md")) return;
      const resolved = posix.normalize(posix.join(dirname(file), path));
      link.href = hrefOf(slugOf(resolved)) + (hash ? `#${hash}` : "");
    },
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = slug(inner);
        if (depth === 2) toc.push({ id, text: inner.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
    },
  });
  // Our own content, so the HTML is trusted. Wide tables scroll inside a keyboard-focusable box.
  const html = (marked.parse(markdown) as string)
    .replaceAll("<table>", '<div class="docs-table" tabindex="0" role="region" aria-label="Scrollable table"><table>')
    .replaceAll("</table>", "</table></div>");
  return { html, toc };
}

/** A page file: GitBook's `description` front matter, and the Markdown body after it. */
function parsed(file: string) {
  const match = read(file).match(/^---\ndescription: "(.*)"\n---\n+([\s\S]*)$/);
  if (!match) throw new Error(`${file}: every docs page needs a description in its front matter`);
  return { description: match[1], markdown: match[2] };
}

export function docPage(s: string) {
  const entry = docPages().find((p) => p.slug === s);
  if (!entry) return null;
  const { description, markdown } = parsed(entry.file);
  return { ...entry, markdown, description, ...render(markdown, entry.file) };
}

/** One level down, skipping code blocks, so joined pages keep one H1. */
function demote(markdown: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

/** Every page as one Markdown document, in SUMMARY order. */
export const docsMarkdown = () =>
  docPages()
    .map((p, i) => (i === 0 ? parsed(p.file).markdown : demote(parsed(p.file).markdown)).trimEnd())
    .join("\n\n") + "\n";

export const docsIndex = () => docPages().map((p) => ({ ...p, description: parsed(p.file).description }));

export const markdownResponse = (body: string, type = "text/markdown") =>
  new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Access-Control-Allow-Origin": "*" } });
