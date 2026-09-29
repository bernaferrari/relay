import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LINE_THRESHOLD = 70;

function gitAt(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function changedFiles(base, root = repositoryRoot) {
  if (base) {
    const common = gitAt(root, "merge-base", base, "HEAD");
    return gitAt(root, "diff", "--name-only", "--diff-filter=ACMRT", `${common}...HEAD`)
      .split("\n")
      .filter(Boolean);
  }
  return gitAt(root, "diff", "--name-only", "--diff-filter=ACMRT", "HEAD")
    .split("\n")
    .filter(Boolean);
}

export function coverageBase(configuredBase, strict, root = repositoryRoot) {
  if (!strict) return configuredBase;
  if (/^0+$/u.test(configuredBase ?? "")) {
    throw new Error("Cannot determine coverage base for a newly created branch");
  }
  return configuredBase || gitAt(root, "rev-parse", "HEAD^");
}

function repoPath(path) {
  return path.split(sep).join("/");
}

function productionSourcePackage(path) {
  const parts = path.split("/");
  if (parts[0] !== "packages" || parts[2] !== "src") return null;
  if (!/\.[cm]?[jt]sx?$/u.test(path) || /\.(?:test|spec|d)\.[cm]?[jt]sx?$/u.test(path)) {
    return null;
  }
  return parts[1];
}

export function parseLcov(content, packageDirectory, root = repositoryRoot) {
  const files = new Map();
  for (const record of content.split("end_of_record")) {
    const source = record.match(/^SF:(.+)$/m)?.[1];
    const found = record.match(/^LF:(\d+)$/m)?.[1];
    const hit = record.match(/^LH:(\d+)$/m)?.[1];
    if (!source || found === undefined || hit === undefined) continue;
    const path = repoPath(relative(root, resolve(root, "packages", packageDirectory, source)));
    if (!path.startsWith(`packages/${packageDirectory}/src/`)) continue;
    files.set(path, { found: Number(found), hit: Number(hit) });
  }
  return files;
}

export function evaluateChangedCoverage(
  changed,
  reports,
  measuredPackages,
  threshold = LINE_THRESHOLD,
) {
  const sourceFiles = changed.filter((path) => measuredPackages.has(productionSourcePackage(path)));
  const missing = sourceFiles.filter((path) => !reports.has(path));
  const measured = sourceFiles.filter((path) => reports.has(path));
  const found = measured.reduce((sum, path) => sum + reports.get(path).found, 0);
  const hit = measured.reduce((sum, path) => sum + reports.get(path).hit, 0);
  const percent = found === 0 ? null : (hit / found) * 100;
  return {
    sourceFiles,
    missing,
    measured,
    found,
    hit,
    percent,
    passed: missing.length === 0 && (percent === null || percent >= threshold),
  };
}

async function coveragePackages() {
  const names = await readdir(resolve(repositoryRoot, "packages"));
  const packages = [];
  for (const name of names) {
    try {
      const manifest = JSON.parse(
        await readFile(resolve(repositoryRoot, "packages", name, "package.json"), "utf8"),
      );
      if (manifest.scripts?.["test:coverage"]) packages.push(name);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return packages;
}

async function main() {
  const strict = process.env.RELAY_COVERAGE_STRICT === "1";
  const configuredBase = process.env.RELAY_COVERAGE_BASE?.trim();
  const base = coverageBase(configuredBase, strict);

  const packages = await coveragePackages();
  const reports = new Map();
  for (const name of packages) {
    let content;
    try {
      content = await readFile(resolve(repositoryRoot, "packages", name, "coverage.lcov"), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (strict) throw new Error(`Missing coverage report for packages/${name}`);
      console.warn(`check-coverage: missing report for packages/${name}; run pnpm test:coverage`);
      continue;
    }
    const packageReport = parseLcov(content, name);
    if (strict && packageReport.size === 0) {
      throw new Error(`Empty coverage report for packages/${name}`);
    }
    for (const [path, coverage] of packageReport) reports.set(path, coverage);
  }

  const changed = changedFiles(base);
  const unmeasured = changed.filter((path) => {
    const name = productionSourcePackage(path);
    return name !== null && !packages.includes(name);
  });
  if (unmeasured.length) {
    const names = [...new Set(unmeasured.map((path) => productionSourcePackage(path)))];
    console.warn(
      `check-coverage: ${unmeasured.length} changed source files in packages without coverage scripts: ${names.join(", ")}`,
    );
  }
  const result = evaluateChangedCoverage(changed, reports, new Set(packages));
  if (result.sourceFiles.length === 0) {
    console.log("check-coverage: no changed source files in measured packages");
    return;
  }
  if (result.missing.length) {
    console.error(`check-coverage: missing coverage for ${result.missing.join(", ")}`);
  }
  if (result.percent !== null) {
    console.log(
      `check-coverage: ${result.measured.length}/${result.sourceFiles.length} files, ${result.hit}/${result.found} lines (${result.percent.toFixed(2)}%).`,
    );
    if (result.percent < LINE_THRESHOLD) {
      console.error(`check-coverage: below ${LINE_THRESHOLD}% changed-source line threshold`);
    }
  }
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`check-coverage: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
