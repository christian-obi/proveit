import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DocsPage from "@/components/DocsPage";
import { docPage, docPages } from "@/lib/docs";

export const dynamicParams = false;

export const generateStaticParams = () => docPages().filter((p) => p.slug).map((p) => ({ slug: p.slug.split("/") }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const page = docPage((await params).slug.join("/"));
  if (!page) return {};
  return {
    title: `${page.title} · Prove-It docs`,
    description: page.description,
    alternates: { canonical: page.href, types: { "text/markdown": page.markdownHref } },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  if (!docPage(slug)) notFound();
  return <DocsPage slug={slug} />;
}
