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
  "packages/core/src/device-mutation-adapter.ts",
  // These modules are cohesive implementation seams extracted from device.ts.
  // They still sit below the public workflow boundary and deliberately own
  // the dispatcher/native transport calls they contain.
  "packages/core/src/device-dispatch.ts",
  "packages/core/src/device-text-entry.ts",
  // Android text entry is a platform-specific dispatcher seam. It owns the
  // clipboard/IME fallback and must remain below the public Device facade.
  "packages/core/src/device-android-text.ts",
]);

/**
 * Private implementation modules that may name a capability seam. They are
 * deliberately fewer than ordinary workflow modules, and tests are excluded
 * from this production-source scan so they can exercise explicit test seams.
 */
export const privateDeviceCapabilityPaths = new Set([
  ...rawDeviceMutationBoundaryPaths,
  "packages/core/src/device-capabilities.ts",
  "packages/core/src/device-observation-membrane.ts",
  "packages/core/src/testing.ts",
]);

const rawSdkBoundaryPaths = new Set([
  "packages/core/src/control.ts",
  "packages/core/src/device-capabilities.ts",
  "packages/core/src/device-mutation-adapter.ts",
  "packages/core/src/device.ts",
  "packages/core/src/device-android-text.ts",
  // Read-only Android app discovery is a narrow host SDK adapter; it never
  // launches or mutates a target and is exported only through core.
  "packages/core/src/android-installed-apps.ts",
]);

const internalDeviceModuleOwners = new Map([
  [
    "device-capabilities",
    new Set([
      "packages/core/src/device.ts",
      "packages/core/src/device-dispatch.ts",
      "packages/core/src/testing.ts",
      "packages/core/src/ios-runner-listener-command.ts",
      "packages/core/src/device-android-text.ts",
    ]),
  ],
  [
    "device-mutation-adapter",
    new Set([
      "packages/core/src/device.ts",
      "packages/core/src/device-dispatch.ts",
      "packages/core/src/device-text-entry.ts",
      "packages/core/src/device-android-text.ts",
    ]),
  ],
  [
    "device-observation-membrane",
    new Set([
      "packages/core/src/browser-target.ts",
      "packages/core/src/device-factory.ts",
      "packages/core/src/device.ts",
      "packages/core/src/device-dispatch.ts",
      "packages/core/src/testing.ts",
    ]),
  ],
]);

const requiredCorePackageEntries = new Set(["./device", "./testing"]);
const forbiddenCorePackageEntries = new Set([
  "./device-capabilities",
  "./device-mutation-adapter",
  "./device-observation-membrane",
]);
const runtimeObservationFacadeOwners = new Set([
  "packages/core/src/browser-target.ts",
  "packages/core/src/device-factory.ts",
  "packages/core/src/device.ts",
  "packages/core/src/testing.ts",
]);

const rawMutationCall =
  /\b(?:target\.)?device\.(?:devices\.boot|apps\.(?:open|close)|interactions\.(?:press|longPress|fill|type|scroll|swipe|pan)|command\.(?:back|home|keyboard|alert|appSwitcher|rotate|prepare)|settings\.update|recording\.record)\s*\(/gu;
const rawFindCall = /\b(?:target\.)?device\.interactions\.find\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/gu;
const rawClipboardCall =
  /\b(?:target\.)?device\.command\.clipboard\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/gu;
const nativeCapabilityEscape =
  /\b(?:bindNativeDeviceMutations|NativeDeviceMutations|DeviceTransport|nativeDevice|deviceTestDouble)\b/gu;
const staticModuleSpecifier =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/gu;
const dynamicModuleSpecifier = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function literalModuleSpecifiers(source) {
  return [staticModuleSpecifier, dynamicModuleSpecifier]
    .flatMap((expression) =>
      [...source.matchAll(expression)].map((match) => ({
        specifier: match[1] ?? "",
        index: match.index ?? 0,
      })),
    )
    .sort((left, right) => left.index - right.index);
}

function normalizedModuleSpecifier(specifier) {
  return specifier.replaceAll("\\", "/").replace(/\.(?:[cm]?js|[cm]?ts|tsx)$/u, "");
}

function internalDeviceModule(specifier) {
  const normalized = normalizedModuleSpecifier(specifier);
  for (const name of internalDeviceModuleOwners.keys()) {
    if (
      normalized === `@relay/core/${name}` ||
      normalized === `@relay/core/src/${name}` ||
      normalized.endsWith(`/${name}`)
    ) {
      return name;
    }
  }
  return undefined;
}

function isRawSdkSpecifier(specifier) {
  return specifier === "agent-device" || specifier.startsWith("agent-device/");
}

/**
 * Check the intentional package boundary as well as source imports. This is a
 * build-time API boundary, not a runtime sandbox: a repository author could
 * still edit package metadata or use a non-literal dynamic import deliberately.
 */
export function evaluateCoreDevicePackageExports(packageJson) {
  const exports = packageJson?.exports;
  const entries = exports && typeof exports === "object" && !Array.isArray(exports) ? exports : {};
  const violations = [];
  for (const entry of requiredCorePackageEntries) {
    if (!(entry in entries)) {
      violations.push(`packages/core/package.json must export ${entry}.`);
    }
  }
  for (const entry of forbiddenCorePackageEntries) {
    if (entry in entries) {
      violations.push(`packages/core/package.json must not export private ${entry}.`);
    }
  }
  return violations;
}

/**
 * Every supported adapter must produce the same runtime observation membrane.
 * The import ownership check above prevents workflow code from doing this
 * itself; this companion check prevents an adapter regression from returning a
 * raw SDK/client object through the public Device type again.
 */
export function evaluateRuntimeObservationFacadeBindings(entries) {
  const sources = new Map(entries.map(({ path, source = "" }) => [path, source]));
  const violations = [];
  for (const path of runtimeObservationFacadeOwners) {
    const source = sources.get(path);
    if (source === undefined) {
      violations.push(`${path} is missing its required runtime Device observation facade binding.`);
      continue;
    }
    const importsMembrane = literalModuleSpecifiers(source).some(({ specifier }) =>
      normalizedModuleSpecifier(specifier).endsWith("/device-observation-membrane"),
    );
    if (!importsMembrane || !/\bcreateDeviceObservationFacade\b/u.test(source)) {
      violations.push(
        `${path} must create public Device values through the runtime observation facade.`,
      );
    }
  }
  return violations;
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
    if (!path.startsWith("packages/") || !path.includes("/src/")) {
      continue;
    }
    const privateCapabilityPath = privateDeviceCapabilityPaths.has(path);
    // The public `Device` type is intentionally read-only. Do not let a
    // workflow recover the hidden SDK transport by importing an internal
    // transport seam under a different local name.
    if (!privateCapabilityPath) {
      for (const match of source.matchAll(nativeCapabilityEscape)) {
        violations.push(
          `${path}:${lineAt(source, match.index ?? 0)} accesses ${match[0]}; ` +
            "workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
        );
      }
    }
    if (!rawDeviceMutationBoundaryPaths.has(path)) {
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
    for (const { specifier, index } of literalModuleSpecifiers(source)) {
      if (specifier === "@relay/core/testing") {
        violations.push(
          `${path}:${lineAt(source, index)} imports @relay/core/testing; ` +
            "test doubles may only be imported from test files.",
        );
      }
      const internalModule = internalDeviceModule(specifier);
      if (internalModule && !internalDeviceModuleOwners.get(internalModule)?.has(path)) {
        violations.push(
          `${path}:${lineAt(source, index)} imports ${specifier}; ` +
            "internal device capability modules are private—use the public device helpers instead.",
        );
      }
      if (isRawSdkSpecifier(specifier) && !rawSdkBoundaryPaths.has(path)) {
        violations.push(
          `${path}:${lineAt(source, index)} imports ${specifier}; ` +
            "raw agent-device access belongs only to the canonical device/control boundary.",
        );
      }
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
    if (!new Set([".ts", ".tsx", ".mts", ".cts"]).has(extname(entry.name))) continue;
    if (/\.(?:test|spec)\.[^.]+$/u.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    files.push(path);
  }
  return files;
}

async function inspectWorkflowSources() {
  const packageDirectories = await readdir(resolve(repositoryRoot, "packages"), {
    withFileTypes: true,
  });
  const sourcePaths = [];
  for (const entry of packageDirectories) {
    if (!entry.isDirectory()) continue;
    const root = resolve(repositoryRoot, "packages", entry.name, "src");
    try {
      sourcePaths.push(...(await sourceFiles(root)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Promise.all(
    sourcePaths.map(async (path) => ({
      path: relative(repositoryRoot, path).split(sep).join("/"),
      source: await readFile(path, "utf8"),
    })),
  );
}

async function main() {
  const [entries, corePackage] = await Promise.all([
    inspectWorkflowSources(),
    readFile(resolve(repositoryRoot, "packages/core/package.json"), "utf8").then(JSON.parse),
  ]);
  const violations = [
    ...evaluateIosMutationBoundaries(entries),
    ...evaluateCoreDevicePackageExports(corePackage),
    ...evaluateRuntimeObservationFacadeBindings(entries),
  ];
  if (violations.length) {
    console.error("Device mutation-boundary check failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Device mutation-boundary check passed: workflow code uses the canonical dispatcher.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
