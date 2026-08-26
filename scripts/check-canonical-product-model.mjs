import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const self = relative(repositoryRoot, fileURLToPath(import.meta.url));

const retiredPatterns = [
  new RegExp(["locale", "matrix"].join("[-_ .]"), "iu"),
  new RegExp(["language", "profile"].join("[-_ .]"), "iu"),
  new RegExp(["switcher", "profile"].join("[-_ .]"), "iu"),
  new RegExp(["switcher", "scan"].join("[-_ .]?"), "iu"),
  new RegExp(["locale", "run"].join("[-_ .]"), "iu"),
  new RegExp(["locale", "pack"].join("[-_ .]"), "iu"),
  new RegExp(["cor", "pus"].join(""), "iu"),
];

const canonicalTeachingBoundary = new Map([
  ["packages/protocol/src/app-map-operation-definitions.ts", "app-map.variable.infer"],
  [
    "packages/server/src/app-map-capture-routes.ts",
    "/app-maps/:appMapId/variables/:variableId/infer",
  ],
  ["packages/app/src/lib/server-combine-remote.ts", 'invoke("app-map.variable.infer"'],
  ["packages/cli/src/commands.ts", '"app-map.variable.infer"'],
  ["packages/mcp/src/tools.ts", '"app-map.variable.infer"'],
]);

export function evaluateCanonicalProductModel(entries) {
  const violations = [];
  for (const { path, source } of entries) {
    if (path === self || path.endsWith("check-canonical-product-model.test.mjs")) continue;
    for (const pattern of retiredPatterns) {
      const pathMatch = pattern.exec(path);
      if (pathMatch) violations.push(`${path}: retired product-model name in path`);
      pattern.lastIndex = 0;
      const sourceMatch = pattern.exec(source);
      if (sourceMatch) {
        const line = source.slice(0, sourceMatch.index).split("\n").length;
        violations.push(`${path}:${line}: retired product-model vocabulary`);
      }
      pattern.lastIndex = 0;
    }
  }

  const sourceByPath = new Map(entries.map((entry) => [entry.path, entry.source]));
  for (const [path, marker] of canonicalTeachingBoundary) {
    if (!sourceByPath.get(path)?.includes(marker)) {
      violations.push(`${path}: canonical Variable teaching boundary is missing ${marker}`);
    }
  }
  return violations;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === ".git")
        continue;
      files.push(...(await sourceFiles(path)));
    } else if ([".ts", ".tsx", ".mjs", ".md", ".json"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

async function main() {
  const roots = ["packages", "scripts", "docs"].map((path) => resolve(repositoryRoot, path));
  const paths = (await Promise.all(roots.map(sourceFiles))).flat();
  paths.push(
    resolve(repositoryRoot, "README.md"),
    resolve(repositoryRoot, "ARCHITECTURE.md"),
    resolve(repositoryRoot, "package.json"),
  );
  const entries = await Promise.all(
    paths.map(async (path) => ({
      path: relative(repositoryRoot, path),
      source: await readFile(path, "utf8"),
    })),
  );
  const violations = evaluateCanonicalProductModel(entries);
  if (violations.length) {
    console.error("Canonical product-model verification failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Canonical product-model verification passed: ${entries.length} files expose only Variable, Test, and Combine, with one typed teaching path.`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
