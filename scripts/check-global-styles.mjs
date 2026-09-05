import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const excluded = new Set(["node_modules", "dist", "build", "out", ".vite", "coverage"]);
async function styles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await styles(path)));
    else if (entry.isFile() && entry.name.endsWith(".css")) found.push(path);
  }
  return found;
}
const violations = (await styles(join(root, "packages"))).filter(
  (path) => basename(path) !== "globals.css",
);
if (violations.length) {
  console.error("Use Tailwind in components; only globals.css may contain shared CSS:");
  console.error(violations.map((path) => `- ${relative(root, path)}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Global stylesheet boundary passed");
}
