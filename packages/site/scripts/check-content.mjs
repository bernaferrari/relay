import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readPages, siteRoot } from "./content.mjs";

const pages = await readPages();
const urls = new Set(pages.map((page) => page.url));
let checked = 0;
let screenshots = 0;
let jsonExamples = 0;
for (const page of pages) {
  assert(
    !/<(?:WorkflowDiagram|DocScreenshot)\b/.test(page.markdown),
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
        /^(bash|json|ts|text|yaml)(?:\s|$)/.test(fence[1]),
        `${page.path}: unknown code-block language`,
      );
  }
  for (const example of page.body.matchAll(/^```json[^\n]*\n([\s\S]*?)^```/gm)) {
    assert.doesNotThrow(() => JSON.parse(example[1]), `${page.path}: invalid JSON example`);
    jsonExamples++;
  }
  for (const image of page.markdown.matchAll(/!\[([^\]]+)\]\((\/images[^)\s]+)\)/g)) {
    await access(resolve(siteRoot, `public${image[2]}`));
    screenshots++;
  }
  assert.equal(
    await readFile(resolve(siteRoot, `public${page.markdownPath}`), "utf8"),
    page.markdown,
    `${page.path}: stale Markdown export; run prepare-content first`,
  );
}
const landing = await readFile(resolve(siteRoot, "src/app/page.tsx"), "utf8");
for (const match of landing.matchAll(/(?:href|link):?=?["{]?"(\/docs[^"#]*)"/g)) {
  assert(urls.has(match[1]), `Landing page: broken local link ${match[1]}`);
  checked++;
}
if (process.argv.includes("--export")) {
  for (const page of pages) {
    const html = await readFile(resolve(siteRoot, `out${page.url}.html`), "utf8");
    assert(html.includes(page.title), `${page.path}: missing exported title`);
    for (const link of page.body.matchAll(/\]\((\/docs[^)\s#]*)(?:#([^)]+))?\)/g)) {
      if (!link[2]) continue;
      const target = await readFile(resolve(siteRoot, `out${link[1]}.html`), "utf8");
      assert(target.includes(`id="${link[2]}"`), `${page.path}: broken exported anchor ${link[0]}`);
    }
  }
}
console.log(
  `Content verified: ${pages.length} pages, ${checked} internal links, ${screenshots} screenshots, ${jsonExamples} JSON examples, fresh Markdown exports, and sidebar ordering.`,
);
