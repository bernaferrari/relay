import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_SOURCE_LIMIT = 900;
export const COMPONENT_SOURCE_LIMIT = 700;

/**
 * Existing large modules are explicit debt, not precedent. Their exact current
 * size is a ratchet: growth fails, and shrinkage asks the author to lower the
 * recorded ceiling in the same change.
 */
export const grandfatheredSourceLimits = Object.freeze({
  "packages/app/src/components/app-map-capture-review.tsx": 1001,
  "packages/app/src/components/app-map-workspace.tsx": 1099,
  "packages/app/src/components/runs-workspace.tsx": 962,
  "packages/app/src/components/stage.tsx": 1386,
  "packages/app/src/components/studio-shell.tsx": 1024,
  "packages/app/src/components/take-action-editor.tsx": 717,
  "packages/core/src/authoring-sessions.ts": 1072,
  "packages/core/src/device.ts": 1356,
  "packages/protocol/src/operations.ts": 1906,
});

export function defaultSourceLimit(path) {
  return path.startsWith("packages/app/src/components/")
    ? COMPONENT_SOURCE_LIMIT
    : DEFAULT_SOURCE_LIMIT;
}

export function sourceLineCount(source) {
  const content = source.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return content ? content.split("\n").length : 0;
}

export function evaluateSourceBudgets(entries, exceptions = grandfatheredSourceLimits) {
  const linesByPath = new Map(entries.map((entry) => [entry.path, entry.lines]));
  const violations = [];

  for (const { path, lines } of entries) {
    const ordinaryLimit = defaultSourceLimit(path);
    const ceiling = exceptions[path];
    if (ceiling === undefined) {
      if (lines > ordinaryLimit) {
        violations.push(
          `${path} has ${lines} lines; split it below the ${ordinaryLimit}-line ${path.includes("/components/") ? "component" : "source"} limit.`,
        );
      }
      continue;
    }
    if (lines > ceiling) {
      violations.push(
        `${path} grew from its ${ceiling}-line ceiling to ${lines}; extract a cohesive module instead.`,
      );
    } else if (lines < ceiling) {
      violations.push(
        `${path} shrank to ${lines} lines; lower its grandfathered ceiling from ${ceiling} in the same change.`,
      );
    }
    if (lines <= ordinaryLimit) {
      violations.push(
        `${path} is now within the ordinary ${ordinaryLimit}-line limit; remove its grandfathered exception.`,
      );
    }
  }

  for (const path of Object.keys(exceptions)) {
    if (!linesByPath.has(path)) {
      violations.push(`${path} no longer exists; remove its grandfathered exception.`);
    }
  }
  return violations;
}

/**
 * App-side observation records are read models, never editable documents.
 * Converting an observation session into AppMap/CanvasGraph in the renderer
 * creates a second authoring truth that bypasses typed proposals and revision
 * checks. Core may project observations into proposals; the app may only
 * render them or invoke the canonical operation boundary.
 */
export function evaluateProductDocumentBoundaries(entries) {
  const violations = [];
  for (const { path, source = "" } of entries) {
    if (!path.startsWith("packages/app/src/") || !source) continue;
    const readsObservationDocument = /\bDiscoverySession\b/u.test(source);
    const authorsMapDocument = /\bCanvasGraph\b/u.test(source);
    if (readsObservationDocument && authorsMapDocument) {
      violations.push(
        `${path} mixes observation-session and App Map document types; project observations through a core review proposal instead.`,
      );
    }
    if (/\b(?:importDiscoveryAppMap|discoverySessionToCanvasGraph)\b/u.test(source)) {
      violations.push(
        `${path} recreates the removed Discovery-to-canvas authoring path; App Map is the only editable document.`,
      );
    }
  }
  return violations;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    files.push(path);
  }
  return files;
}

async function inspectRepository() {
  const packageDirectories = await readdir(resolve(repositoryRoot, "packages"), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of packageDirectories) {
    if (!entry.isDirectory()) continue;
    const sourceRoot = resolve(repositoryRoot, "packages", entry.name, "src");
    try {
      files.push(...(await sourceFiles(sourceRoot)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Promise.all(
    files.map(async (path) => {
      const source = await readFile(path, "utf8");
      return {
        path: relative(repositoryRoot, path).split(sep).join("/"),
        lines: sourceLineCount(source),
        source,
      };
    }),
  );
}

async function main() {
  const entries = await inspectRepository();
  const violations = [
    ...evaluateSourceBudgets(entries),
    ...evaluateProductDocumentBoundaries(entries),
  ];
  if (violations.length) {
    console.error("Source maintainability budget failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  const grandfathered = Object.keys(grandfatheredSourceLimits).length;
  console.log(
    `Source maintainability budget passed: ${entries.length} modules checked; ${grandfathered} explicit ceilings may only shrink.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
