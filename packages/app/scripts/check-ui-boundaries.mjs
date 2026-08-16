import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const forbidden =
  /(?:relay-(?:text|panel|line|accent)-[23]|relay-(?:data|workflow)(?:[-_]|\b)|--v2-|v2-background|v2-border|v2-elevation|bg-v2-)/g;
const arbitraryType = /\btext-\[\d+(?:\.\d+)?px\]/g;
const numberedType =
  /\btext-(?:8|9|10|11|12|13|14|15|16|18|20|24|28)(?:-(?:regular|medium|semibold|bold))?\b/g;
const arbitraryRadius = /\brounded(?:-[a-z]+)?-\[\d+(?:\.\d+)?px\]/g;
const bannedVocab =
  /(['"`])(?:(?!\1)[^\n])*?\b(?:State set|Combine|Variable)\b(?:(?!\1)[^\n])*?\1|>\s*(?:State set|Combine|Variable)\b/g;

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (/\.(?:tsx|ts|css)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const violations = [];
for (const directory of ["components", "lib", "pages", "context", "styles"]) {
  const dir = join(root, directory);
  let files;
  try {
    files = await filesIn(dir);
  } catch {
    continue;
  }
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(forbidden)) {
      violations.push(`${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]}`);
    }
    if (file.endsWith(".tsx") || file.endsWith(".ts") || file.endsWith(".css")) {
      for (const match of source.matchAll(arbitraryType)) {
        violations.push(
          `${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]} (use text-micro/caption/body/title/display)`,
        );
      }
      for (const match of source.matchAll(numberedType)) {
        violations.push(
          `${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]} (use text-micro/caption/body/title/display)`,
        );
      }
      for (const match of source.matchAll(arbitraryRadius)) {
        violations.push(
          `${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]} (use rounded-sm … rounded-3xl)`,
        );
      }
    }
    if (file.endsWith(".tsx")) {
      for (const match of source.matchAll(bannedVocab)) {
        violations.push(
          `${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]} (say Modifier / Run matrix)`,
        );
      }
    }
  }
}

if (violations.length) {
  console.error(
    "UI boundary violations: use classic semantic tokens (no --v2-* / retired classes), the documented type/radius scale, and Modifier / Run matrix in chrome.",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    "UI boundary check passed: classic tokens, documented type/radius scale, Modifier / Run matrix chrome.",
  );
}
