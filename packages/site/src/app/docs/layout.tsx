import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { RelayBrand } from "@/components/relay-brand";
import { source } from "@/lib/source";
import { repositoryUrl } from "@/lib/site";

export default function DocumentationLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: <RelayBrand docs /> }}
      githubUrl={repositoryUrl}
      links={[{ text: "Website", url: "/" }]}
      sidebar={{ defaultOpenLevel: 1 }}
    >
      {children}
    </DocsLayout>
  );
}
