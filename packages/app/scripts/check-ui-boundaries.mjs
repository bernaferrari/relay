import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const protocolRoot = fileURLToPath(new URL("../../protocol/src/", import.meta.url));
const forbidden =
  /(?:relay-(?:text|panel|line|accent)-[23]|relay-(?:data|workflow)(?:[-_]|\b)|--v2-|v2-background|v2-border|v2-elevation|bg-v2-)/g;
const arbitraryType = /\btext-\[\d+(?:\.\d+)?px\]/g;
const numberedType =
  /\btext-(?:8|9|10|11|12|13|14|15|16|18|20|24|28)(?:-(?:regular|medium|semibold|bold))?\b/g;
const arbitraryRadius = /\brounded(?:-[a-z]+)?-\[\d+(?:\.\d+)?px\]/g;
/** Legacy-shell vocabulary guard. Product V2 has the stricter public-language
 * boundary in PRODUCT_V2.md; this checker remains scoped to the Solid app while
 * it is retired route by route. Historical euphemisms stay banned here so the
 * legacy UI does not expand a second vocabulary during migration. */
const banned = String.raw`State\sset|[Mm]odifiers?|[Rr]un\smatri(?:x|ces)`;
const bannedVocab = new RegExp(
  String.raw`(['"\`])(?:(?!\1)[^\n])*?\b(?:${banned})\b(?:(?!\1)[^\n])*?\1|>\s*(?:${banned})\b`,
  "g",
);
/**
 * Raw thrown text in a toast. human-error.ts is the single funnel for
 * person-facing failures, and it is what turns "Failed to fetch" into "Relay
 * could not reach the server. Start it, then try again." Passing `error.message`
 * straight to toast() bypasses it and shows the person a browser or driver
 * string, so the pattern is banned rather than left to reviewer memory.
 */
const rawErrorToast = /toast\(\s*(?:[A-Za-z_$][\w$]*\.)?[^)]*?\berror\s*instanceof\s+Error\s*\?/g;
/**
 * The same leak one line apart: `const message = err instanceof Error ? …` and
 * then `toast(message)` or `setError(message)`. Raw text is the right thing to
 * hand appendLog, which is a diagnostic record, so only the two person-facing
 * sinks are checked, and only when they read the raw binding directly.
 */
const rawErrorSink =
  /const\s+(\w+)\s*=\s*\w+\s+instanceof\s+Error\s*\?[^;]*;(?:[^}]*?)\b(?:toast\(\1\s*,|setError\(\1\))/g;

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

// The renderer imports the protocol barrel at runtime. A Node-only module in
// that barrel externalizes `node:*` in Vite and produces a blank page instead
// of a useful compile error, so keep the browser boundary executable here.
const protocolIndex = await readFile(join(protocolRoot, "index.ts"), "utf8");
for (const match of protocolIndex.matchAll(/export \* from "\.\/(.+)\.js";/g)) {
  const modulePath = join(protocolRoot, `${match[1]}.ts`);
  const source = await readFile(modulePath, "utf8");
  if (/from\s+["']node:/u.test(source)) {
    violations.push(`${modulePath}: Node-only module exported through the browser protocol barrel`);
  }
}
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
    for (const pattern of [rawErrorToast, rawErrorSink]) {
      for (const match of source.matchAll(pattern)) {
        violations.push(
          `${file}:${source.slice(0, match.index).split("\n").length}: raw error text shown to a person (wrap it in humanError(error, "Could not …"); appendLog may keep the raw text)`,
        );
      }
    }
    if (file.endsWith(".tsx")) {
      for (const match of source.matchAll(bannedVocab)) {
        violations.push(
          `${file}:${source.slice(0, match.index).split("\n").length}: ${match[0]} (use the existing legacy term; new product language belongs in Product V2)`,
        );
      }
    }
  }
}

if (violations.length) {
  console.error(
    "UI boundary violations: use classic semantic tokens (no --v2-* / retired classes), the documented type/radius scale, the frozen legacy vocabulary, and humanError() for every failure a person reads.",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    "UI boundary check passed: classic tokens, documented type/radius scale, product vocabulary in chrome, person-facing error text.",
  );
}
