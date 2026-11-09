// A docs page laid out like GitBook: page tree, article, "on this page", previous and next.

import Link from "next/link";
import CopyMarkdown from "@/components/CopyMarkdown";
import DocsNav from "@/components/DocsNav";
import { docPage, docPages } from "@/lib/docs";

export default function DocsPage({ slug }: { slug: string }) {
  const page = docPage(slug);
  if (!page) return null;
  const pages = docPages();
  const at = pages.findIndex((p) => p.slug === slug);
  const prev = pages[at - 1];
  const next = pages[at + 1];
  return (
    <div className="wide grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <DocsNav pages={pages.map(({ title, href, group }) => ({ title, href, group }))} />
      </aside>

      <div className="min-w-0 max-w-3xl">
        <p className="mb-5 flex flex-wrap items-center gap-2">
          <CopyMarkdown markdown={page.markdown} />
          <a className="chip" href={page.markdownHref}>
            View as Markdown
          </a>
          <a className="chip" href="/llms.txt">
            llms.txt
          </a>
        </p>
        <article className="docs" dangerouslySetInnerHTML={{ __html: page.html }} />
        <nav className="mt-10 grid gap-2 sm:grid-cols-2" aria-label="Previous and next page">
          {prev ? (
            <Link href={prev.href} className="doc-pager">
              <span className="label">Previous</span>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={next.href} className="doc-pager sm:text-right">
              <span className="label">Next</span>
              {next.title}
            </Link>
          )}
        </nav>
      </div>

      {page.toc.length > 0 && (
        <aside className="hidden xl:sticky xl:top-4 xl:block" aria-label="On this page">
          <p className="label mb-2">On this page</p>
          <ul className="space-y-1 text-sm">
            {page.toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className="text-muted hover:text-accent">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
