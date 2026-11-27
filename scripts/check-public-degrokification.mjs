import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [
  "packages/core/src",
  "packages/product/src",
  "packages/workflows/src",
  "packages/workflow-runners/src",
  "packages/server/src",
  "packages/cli/src",
  "packages/mcp/src",
  "packages/app/src",
  "packages/desktop/src",
  "packages/tui/src",
  "packages/site",
  "packages/runtime/scripts",
  "packages/e2e/src",
  "scripts",
];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".md", ".mdx"]);
const productVocabulary = new RegExp(["gr", "ok"].join(""), "iu");

function extensionOf(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function visit(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry)) continue;
      visit(path, files);
    } else if (extensions.has(extensionOf(entry))) {
      files.push(path);
    }
  }
  return files;
}

function isFixtureOrTest(path) {
  return (
    path.includes("/fixtures/") ||
    path.includes("__tests__") ||
    path.includes(".test.") ||
    path.includes("fixture")
  );
}

const violations = [];
for (const root of roots) {
  for (const file of visit(root)) {
    if (isFixtureOrTest(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!productVocabulary.test(text)) continue;
    const lines = text
      .split("\n")
      .flatMap((line, index) => (productVocabulary.test(line) ? [index + 1] : []));
    violations.push(`${file}:${lines.join(",")}`);
  }
}

if (violations.length) {
  console.error("Product-owned application vocabulary leaked outside tests and fixtures:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("Public application-vocabulary boundary check passed for production source.");
