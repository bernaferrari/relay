import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const siteRoot = resolve(import.meta.dirname, "..");
export const contentRoot = resolve(siteRoot, "content/docs");

async function files(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      result.push(...(await files(resolve(directory, entry.name), `${path}/`)));
    else if (entry.name.endsWith(".mdx")) result.push(path);
  }
  return result;
}

export function markdownBody(body) {
  return body
    .replace(
      /<WorkflowDiagram\s*\/>/g,
      "Record a real journey → Replay saved steps → Inspect this Run's evidence → Keep your review decision.",
    )
    .replace(
      /<DocScreenshot\s+src="([^"\n]+)"\s+alt="([^"\n]+)"\s+caption="([^"\n]+)"\s*\/>/g,
      (_, src, alt, caption) => `![${alt}](${src})\n\n${caption}`,
    );
}

export async function readPages() {
  return Promise.all(
    (await files(contentRoot)).map(async (path) => {
      const text = await readFile(resolve(contentRoot, path), "utf8");
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
      const title = frontmatter?.[1].match(/^title: (.+)$/m)?.[1];
      const description = frontmatter?.[1].match(/^description: (.+)$/m)?.[1];
      if (!title || !description)
        throw new Error(`${path}: title and description must be single-line frontmatter fields`);
      const slug = path.replace(/\.mdx$/, "");
      const body = text.slice(frontmatter[0].length).trim();
      return {
        path,
        title,
        description,
        body,
        url: slug === "index" ? "/docs" : `/docs/${slug}`,
        markdownPath: `/docs/${slug}.md`,
        markdown: `# ${title}\n\n${description}\n\n${markdownBody(body)}\n`,
      };
    }),
  );
}
