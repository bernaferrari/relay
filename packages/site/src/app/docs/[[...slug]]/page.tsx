import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import { getMDXComponents } from "@/mdx-components";
import { source } from "@/lib/source";
import { repositoryUrl } from "@/lib/site";

type Props = { params: Promise<{ slug?: string[] }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return source.generateParams();
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) return {};
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
  };
}

export default async function DocumentationPage({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Body = page.data.body;
  const markdownUrl = `${page.url === "/docs" ? "/docs/index" : page.url}.md`;
  return (
    <DocsPage toc={page.data.toc} id="main-content">
      {page.url === "/docs" ? (
        <div className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <span className="h-0.5 w-8 bg-primary" aria-hidden="true" /> The Relay field guide
        </div>
      ) : null}
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground [&_a]:inline-flex [&_a]:min-h-9 [&_a]:items-center [&_a]:underline-offset-4 [&_a:hover]:text-foreground [&_a:hover]:underline">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <a
          href={`${repositoryUrl}/blob/main/packages/site/content/docs/${page.path}`}
          target="_blank"
          rel="noreferrer"
        >
          View source
        </a>
        <a href={markdownUrl}>Markdown</a>
      </div>
      <DocsBody>
        <Body components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
