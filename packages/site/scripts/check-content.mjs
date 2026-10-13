import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readPages, siteRoot } from "./content.mjs";

const pages = await readPages();
const urls = new Set(pages.map((page) => page.url));
let checked = 0;
for (const page of pages) {
  assert(
    !page.markdown.includes("<WorkflowDiagram"),
    `${page.path}: raw Markdown must not depend on a React component`,
  );
  for (const match of page.body.matchAll(/\]\((\/docs[^)\s#]*)(?:#[^)]*)?\)/g)) {
    assert(urls.has(match[1]), `${page.path}: broken local link ${match[1]}`);
    checked++;
  }
  const metaFile = resolve(
    siteRoot,
    "content/docs",
    page.path.includes("/") ? page.path.split("/")[0] : "",
    "meta.json",
  );
  const meta = JSON.parse(await readFile(metaFile, "utf8"));
  assert(
    meta.pages.includes(
      page.path
        .split("/")
        .at(-1)
        .replace(/\.mdx$/, ""),
    ),
    `${page.path}: absent from sidebar ordering`,
  );
  for (const fence of page.body.matchAll(/^```([^\n]*)\n/gm)) {
    // Closing fences have no content; all opening fences must name a language.
    if (fence[1])
      assert(
        /^(bash|json|ts|text)(?:\s|$)/.test(fence[1]),
        `${page.path}: unknown code-block language`,
      );
  }
  await access(resolve(siteRoot, `public${page.markdownPath}`));
}
const landing = await readFile(resolve(siteRoot, "src/app/page.tsx"), "utf8");
for (const match of landing.matchAll(/(?:href|link):?=?["{]?"(\/docs[^"#]*)"/g)) {
  assert(urls.has(match[1]), `Landing page: broken local link ${match[1]}`);
  checked++;
}
console.log(
  `Content verified: ${pages.length} pages, ${checked} internal links, Markdown exports, and sidebar ordering.`,
);
