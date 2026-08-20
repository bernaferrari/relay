import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * These are the only core modules allowed to invoke the raw device mutation
 * capability. All workflow code must go through the public device helpers,
 * where iOS has one-command outcome handling and Android retains its explicit
 * retry contract. Keeping the list small turns a new escape hatch into a
 * deliberate architecture review rather than an accidental fallback.
 */
export const rawDeviceMutationBoundaryPaths = new Set([
  "packages/core/src/device.ts",
  "packages/core/src/device-capabilities.ts",
  "packages/core/src/device-mutation-adapter.ts",
]);

const rawMutationCall =
  /\b(?:target\.)?device\.(?:devices\.boot|apps\.(?:open|close)|interactions\.(?:press|longPress|fill|type|scroll|swipe|pan)|command\.(?:back|home|keyboard|alert|appSwitcher|rotate|prepare)|settings\.update|recording\.record)\s*\(/gu;
const rawFindCall = /\b(?:target\.)?device\.interactions\.find\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/gu;
const rawClipboardCall =
  /\b(?:target\.)?device\.command\.clipboard\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/gu;
const nativeCapabilityEscape =
  /\b(?:bindNativeDeviceMutations|NativeDeviceMutations|DeviceTransport|nativeDevice|deviceTestDouble)\b/gu;

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * Detect workflow access to raw physical device mutation capabilities.
 *
 * This is intentionally an architecture check rather than a behavioral
 * terminality test: execution still proves exact-once results at public
 * boundaries, while this rule prevents new workflows from bypassing the
 * dispatcher that owns that behavior.
 */
export function evaluateIosMutationBoundaries(entries) {
  const violations = [];
  for (const { path, source = "" } of entries) {
    if (!path.startsWith("packages/core/src/") || rawDeviceMutationBoundaryPaths.has(path)) {
      continue;
    }
    // The public `Device` type is intentionally read-only. Do not let a
    // workflow recover the hidden SDK transport by importing an internal
    // transport seam under a different local name.
    for (const match of source.matchAll(nativeCapabilityEscape)) {
      violations.push(
        `${path}:${lineAt(source, match.index ?? 0)} accesses ${match[0]}; ` +
          "workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      );
    }
    for (const match of source.matchAll(rawMutationCall)) {
      violations.push(
        `${path}:${lineAt(source, match.index ?? 0)} directly invokes ${match[0].trim()}; ` +
          "route physical input through packages/core/src/device.ts instead.",
      );
    }
    for (const match of source.matchAll(rawFindCall)) {
      // `exists` is a bounded semantic observation. A click (or a dynamic
      // action) is a physical command and must use the canonical dispatcher.
      if (/\baction\s*:\s*["']exists["']/u.test(match[1] ?? "")) continue;
      violations.push(
        `${path}:${lineAt(source, match.index ?? 0)} directly invokes device.interactions.find(; ` +
          "route physical input through packages/core/src/device.ts instead.",
      );
    }
    for (const match of source.matchAll(rawClipboardCall)) {
      // Clipboard reads are observation. A write, paste, copy, or dynamic
      // action can change device state and belongs behind the dispatcher.
      if (/\baction\s*:\s*["']read["']/u.test(match[1] ?? "")) continue;
      violations.push(
        `${path}:${lineAt(source, match.index ?? 0)} directly invokes device.command.clipboard(; ` +
          "route physical input through packages/core/src/device.ts instead.",
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
    if (extname(entry.name) !== ".ts" || /\.(?:test|spec)\.ts$/u.test(entry.name)) continue;
    files.push(path);
  }
  return files;
}

async function inspectCoreSources() {
  const root = resolve(repositoryRoot, "packages/core/src");
  return Promise.all(
    (await sourceFiles(root)).map(async (path) => ({
      path: relative(repositoryRoot, path).split(sep).join("/"),
      source: await readFile(path, "utf8"),
    })),
  );
}

async function main() {
  const violations = evaluateIosMutationBoundaries(await inspectCoreSources());
  if (violations.length) {
    console.error("Raw iOS mutation-boundary check failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log("iOS mutation-boundary check passed: workflow code uses the canonical dispatcher.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
