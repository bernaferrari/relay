import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { siteOrigin } from "@/lib/site";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteOrigin, priority: 1 },
    ...source.getPages().map((page) => ({ url: `${siteOrigin}${page.url}`, priority: 0.8 })),
  ];
}
