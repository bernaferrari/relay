import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const forbidden = /(?:relay-(?:text|panel|line|accent)-[23]|relay-(?:data|workflow)(?:[-_]|\b))/g;

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (/\.(?:tsx|ts)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await filesIn(join(root, "components"))) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(forbidden)) {
    violations.push(`${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]}`);
  }
}

if (violations.length) {
  console.error("UI boundary violations: use semantic @relay/ui tokens in components.");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("UI boundary check passed: no numbered or retired component classes in TSX.");
}
