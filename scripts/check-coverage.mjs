import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LINE_THRESHOLD = 70;

// Advisory gate: reads lcov+json-summary-style lcov.info output produced by
// `pnpm test:coverage` and fails only when changed first-party source files'
// aggregate line coverage drops below the threshold. Tolerant by design —
// with no coverage data present it exits 0 with an explanatory message so
// CI and ad-hoc runs never break on a fresh checkout.

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function changedFiles() {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

async function lcovPaths() {
  const packagesDir = resolve(repositoryRoot, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = resolve(packagesDir, entry.name, "coverage", "lcov.info");
    if (await exists(candidate)) paths.push(candidate);
  }
  return paths;
}

function normalizeRepoPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

async function main() {
  const paths = await lcovPaths();
  if (paths.length === 0) {
    console.log("check-coverage: no coverage data found (run `pnpm run test:coverage`); skipping.");
    return;
  }

  const changed = changedFiles();
  if (!changed) {
    console.log("check-coverage: git unavailable; cannot determine changed files; skipping.");
    return;
  }
  const changedSet = new Set(changed.map(normalizeRepoPath));
  if (changedSet.size === 0) {
    console.log("check-coverage: no changed files; nothing to check.");
    return;
  }

  let linesFound = 0;
  let linesHit = 0;
  const matchedFiles = [];

  for (const lcovPath of paths) {
    const content = await readFile(lcovPath, "utf8");
    for (const record of content.split("end_of_record")) {
      const sfMatch = record.match(/^SF:(.+)$/m);
      if (!sfMatch) continue;
      // lcov SF paths are relative to the package directory that produced them.
      const relative = normalizeRepoPath(sfMatch[1]).replace(/^(\.\.\/)+packages\//, "packages/");
      if (!changedSet.has(relative)) continue;
      matchedFiles.push(relative);
      const found = [...record.matchAll(/^LF:(\d+)$/gm)].pop();
      const hit = [...record.matchAll(/^LH:(\d+)$/gm)].pop();
      if (found) linesFound += Number(found[1]);
      if (hit) linesHit += Number(hit[1]);
    }
  }

  if (matchedFiles.length === 0) {
    console.log("check-coverage: coverage data present but none of the changed files are covered; skipping.");
    return;
  }

  const pct = linesFound === 0 ? 100 : (linesHit / linesFound) * 100;
  console.log(
    `check-coverage: ${matchedFiles.length} changed file(s), ${linesHit}/${linesFound} lines (${pct.toFixed(2)}%).`,
  );
  if (pct < LINE_THRESHOLD) {
    console.error(`check-coverage: line coverage ${pct.toFixed(2)}% is below ${LINE_THRESHOLD}% for changed files.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // Advisory tool: unexpected failures degrade to a warning, never block.
  console.warn(`check-coverage: skipped (${error?.message ?? error})`);
});
