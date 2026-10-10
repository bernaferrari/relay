import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProductAdvancedVocabulary } from "./product-contract.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = join(root, "packages/app/src");
const advancedFiles = new Set([
  "components/test-editor-step.tsx",
  "components/test-editor-assertion.tsx",
  "components/run-report-formatters.tsx",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:tsx|ts)$/u.test(entry.name) && !entry.name.endsWith(".test.tsx"))
      files.push(path);
  }
  return files;
}

export function findForbiddenPrimaryCopy(source, file = "") {
  if (advancedFiles.has(file)) return [];
  const jsxText = [...source.matchAll(/>([^<>]+)</gu)]
    .map((match) => match[1].replace(/\s+/gu, " ").trim())
    .filter((text) => text && !/[{}();=]/u.test(text))
    .join("\n");
  return findProductAdvancedVocabulary(jsxText).filter((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "u").test(jsxText),
  );
}

export async function checkProductCopy() {
  const violations = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const relativePath = relative(sourceRoot, file);
    if (relativePath.startsWith("data/") || relativePath.startsWith("platform/")) continue;
    for (const term of findForbiddenPrimaryCopy(await readFile(file, "utf8"), relativePath)) {
      violations.push(`${relativePath}: forbidden primary term ${term}`);
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkProductCopy();
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else console.log("Product copy contract passed");
}
