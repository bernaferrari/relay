import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readPages, siteRoot } from "./content.mjs";

const pages = await readPages();
const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002").replace(/\/$/, "");
for (const page of pages) {
  const destination = resolve(siteRoot, `public${page.markdownPath}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, page.markdown);
}
await writeFile(
  resolve(siteRoot, "public/llms.txt"),
  [
    "# Relay",
    "",
    "> Relay is a local visual testing workspace for web, Android, and iOS. Record, replay, and review evidence in the UI, CLI, or MCP.",
    "",
    "Relay currently runs from source. Upstream e2e integration is an opt-in prototype.",
    "",
    "## Documentation",
    "",
    ...pages.map((page) => `- [${page.title}](${origin}${page.markdownPath}): ${page.description}`),
    "",
    "## Complete documentation",
    "",
    `- [All guides](${origin}/llms-full.txt)`,
    "",
  ].join("\n"),
);
await writeFile(
  resolve(siteRoot, "public/llms-full.txt"),
  pages.map((page) => `${page.markdown}\n---\n`).join("\n"),
);
console.log(`Prepared Markdown exports and LLM indexes for ${pages.length} documentation pages.`);
