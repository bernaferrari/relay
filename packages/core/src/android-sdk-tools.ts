/**
 * The one host-side Android SDK tool contract used by Relay.
 *
 * Android tools are intentionally resolved from an SDK installation rather
 * than from PATH. A watched server, an interactive CLI, and an Electron host
 * can all inherit a different PATH; accepting whichever `adb` happens to be
 * first would make target identity and build evidence nondeterministic.
 */
import { access, readdir, stat } from "node:fs/promises";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const ANDROID_SDK_TOOLS = ["adb", "emulator", "aapt", "aapt2", "apkanalyzer"] as const;

export type AndroidSdkTool = (typeof ANDROID_SDK_TOOLS)[number];

export type AndroidSdkResolverOptions = {
  /** Explicit environment for deterministic tests or embedded hosts. */
  env?: NodeJS.ProcessEnv;
  /** Override the host platform when testing platform-specific defaults. */
  platform?: NodeJS.Platform;
  /** Override the home directory when testing standard SDK locations. */
  homeDirectory?: string;
};

export type AndroidSdkRoot = {
  path: string;
  source: "ANDROID_SDK_ROOT" | "ANDROID_HOME" | "default";
};

export type AndroidSdkToolCandidate = {
  path: string;
  sdkRoot: string;
  source: AndroidSdkRoot["source"];
  /** Build-tools/cmdline-tools directory, when the tool is versioned. */
  version?: string;
};

export type AndroidSdkToolDiagnostics = {
  tool: AndroidSdkTool;
  platform: NodeJS.Platform;
  sdkRoots: AndroidSdkRoot[];
  candidates: AndroidSdkToolCandidate[];
  /** True only for candidates that exist and are executable. */
  executableCandidates: AndroidSdkToolCandidate[];
  message: string;
};

export type AndroidSdkToolErrorCode = "tool-missing" | "tool-ambiguous";

/** Two explicit SDK variables pointing at different installs are unsafe. */
export class AndroidSdkRootConfigurationError extends Error {
  readonly code = "sdk-roots-ambiguous" as const;
  readonly roots: readonly AndroidSdkRoot[];

  constructor(roots: readonly AndroidSdkRoot[]) {
    const [sdkRoot, androidHome] = roots;
    super(
      `Android SDK configuration is ambiguous: ANDROID_SDK_ROOT (${sdkRoot?.path ?? "unset"}) ` +
        `and ANDROID_HOME (${androidHome?.path ?? "unset"}) point to different SDK roots. ` +
        "Set both variables to the same installation or unset one; PATH is intentionally ignored.",
    );
    this.name = "AndroidSdkRootConfigurationError";
    this.roots = roots;
  }
}

/** A resolution failure that keeps searched roots and candidates actionable. */
export class AndroidSdkToolError extends Error {
  readonly code: AndroidSdkToolErrorCode;
  readonly tool: AndroidSdkTool;
  readonly diagnostics: AndroidSdkToolDiagnostics;

  constructor(
    code: AndroidSdkToolErrorCode,
    tool: AndroidSdkTool,
    diagnostics: AndroidSdkToolDiagnostics,
  ) {
    super(diagnostics.message);
    this.name = "AndroidSdkToolError";
    this.code = code;
    this.tool = tool;
    this.diagnostics = diagnostics;
  }
}

function toolName(tool: AndroidSdkTool, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${tool}.exe` : tool;
}

function uniqueRoots(options: AndroidSdkResolverOptions): AndroidSdkRoot[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDirectory ?? homedir();
  const configured: AndroidSdkRoot[] = [];

  for (const [name, source] of [
    ["ANDROID_SDK_ROOT", "ANDROID_SDK_ROOT"],
    ["ANDROID_HOME", "ANDROID_HOME"],
  ] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    configured.push({ path: normalizeRoot(value), source });
  }

  // Once the operator has explicitly configured an SDK root, only configured
  // roots participate. Falling back to a machine default after a typo in the
  // environment would silently use a different SDK and is not auditable.
  if (configured.length > 1 && configured[0]!.path !== configured[1]!.path) {
    throw new AndroidSdkRootConfigurationError(configured);
  }
  if (configured.length > 0) return dedupeRoots(configured);

  const defaults =
    platform === "darwin"
      ? [join(home, "Library", "Android", "sdk")]
      : platform === "win32"
        ? [join(env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"), "Android", "Sdk")]
        : [join(home, "Android", "Sdk")];
  return dedupeRoots(defaults.map((path) => ({ path: normalizeRoot(path), source: "default" })));
}

function normalizeRoot(value: string): string {
  // SDK variables are commonly absolute, but resolving relative values makes
  // the chosen executable independent of which child process invokes Relay.
  return resolve(value);
}

function dedupeRoots(roots: AndroidSdkRoot[]): AndroidSdkRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.path)) return false;
    seen.add(root.path);
    return true;
  });
}

/** Return roots in the exact order the resolver audits. */
export function androidSdkRoots(options: AndroidSdkResolverOptions = {}): AndroidSdkRoot[] {
  return uniqueRoots(options).map((root) => ({ ...root }));
}

function compareVersions(left: string, right: string): number {
  if (left === "latest") return right === "latest" ? 0 : -1;
  if (right === "latest") return 1;
  return right.localeCompare(left, undefined, { numeric: true });
}

function candidateDefinitions(
  tool: AndroidSdkTool,
  root: AndroidSdkRoot,
  platform: NodeJS.Platform,
  versions: readonly string[],
): AndroidSdkToolCandidate[] {
  const executable = toolName(tool, platform);
  if (tool === "adb") {
    return [
      {
        path: join(root.path, "platform-tools", executable),
        sdkRoot: root.path,
        source: root.source,
      },
    ];
  }
  if (tool === "emulator") {
    return [
      { path: join(root.path, "emulator", executable), sdkRoot: root.path, source: root.source },
    ];
  }
  if (tool === "apkanalyzer") {
    return [
      ...versions.map((version) => ({
        path: join(root.path, "cmdline-tools", version, "bin", executable),
        sdkRoot: root.path,
        source: root.source,
        version,
      })),
      {
        path: join(root.path, "tools", "bin", executable),
        sdkRoot: root.path,
        source: root.source,
      },
    ];
  }
  return versions.map((version) => ({
    path: join(root.path, "build-tools", version, executable),
    sdkRoot: root.path,
    source: root.source,
    version,
  }));
}

async function toolCandidates(
  tool: AndroidSdkTool,
  root: AndroidSdkRoot,
  platform: NodeJS.Platform,
): Promise<AndroidSdkToolCandidate[]> {
  if (tool === "adb" || tool === "emulator") return candidateDefinitions(tool, root, platform, []);
  const parent = join(root.path, tool === "apkanalyzer" ? "cmdline-tools" : "build-tools");
  const entries = await readdir(parent).catch(() => []);
  const versions = entries.sort(compareVersions);
  return candidateDefinitions(tool, root, platform, versions);
}

function toolCandidatesSync(
  tool: AndroidSdkTool,
  root: AndroidSdkRoot,
  platform: NodeJS.Platform,
): AndroidSdkToolCandidate[] {
  if (tool === "adb" || tool === "emulator") return candidateDefinitions(tool, root, platform, []);
  const parent = join(root.path, tool === "apkanalyzer" ? "cmdline-tools" : "build-tools");
  let entries: string[] = [];
  try {
    entries = readdirSync(parent);
  } catch {
    // The diagnostics retain the root and empty candidate list.
  }
  return candidateDefinitions(tool, root, platform, entries.sort(compareVersions));
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function isExecutableSync(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function diagnosticsMessage(
  code: AndroidSdkToolErrorCode,
  tool: AndroidSdkTool,
  diagnostics: Omit<AndroidSdkToolDiagnostics, "message">,
): string {
  const roots = diagnostics.sdkRoots.map((root) => root.path).join(", ") || "none";
  const paths = diagnostics.executableCandidates.map((candidate) => candidate.path).join(", ");
  if (code === "tool-ambiguous") {
    return (
      `Android SDK tool "${tool}" is ambiguous: more than one executable was found ` +
      `across SDK roots (${paths}). Set only one of ANDROID_SDK_ROOT or ANDROID_HOME ` +
      "to the intended SDK installation. PATH is intentionally ignored."
    );
  }
  return (
    `Android SDK tool "${tool}" is unavailable: no executable was found in SDK roots ` +
    `(${roots}). Checked ${diagnostics.candidates.length} candidate path(s)` +
    (diagnostics.candidates.length
      ? `: ${diagnostics.candidates.map((candidate) => candidate.path).join(", ")}`
      : ".") +
    " Set ANDROID_SDK_ROOT or ANDROID_HOME to a valid SDK installation; PATH is intentionally ignored."
  );
}

function makeDiagnostics(
  code: AndroidSdkToolErrorCode,
  tool: AndroidSdkTool,
  platform: NodeJS.Platform,
  sdkRoots: AndroidSdkRoot[],
  candidates: AndroidSdkToolCandidate[],
  executableCandidates: AndroidSdkToolCandidate[],
): AndroidSdkToolDiagnostics {
  const partial = { tool, platform, sdkRoots, candidates, executableCandidates };
  return { ...partial, message: diagnosticsMessage(code, tool, partial) };
}

function selectCandidate(
  tool: AndroidSdkTool,
  platform: NodeJS.Platform,
  sdkRoots: AndroidSdkRoot[],
  candidates: AndroidSdkToolCandidate[],
  executableCandidates: AndroidSdkToolCandidate[],
): AndroidSdkToolCandidate {
  // Multiple SDK roots are never silently merged. An adb from one install and
  // an aapt from another could produce an APK identity that cannot be reproduced.
  const roots = new Set(executableCandidates.map((candidate) => candidate.sdkRoot));
  if (roots.size > 1) {
    const diagnostics = makeDiagnostics(
      "tool-ambiguous",
      tool,
      platform,
      sdkRoots,
      candidates,
      executableCandidates,
    );
    throw new AndroidSdkToolError("tool-ambiguous", tool, diagnostics);
  }
  const selected = executableCandidates[0];
  if (!selected) {
    const diagnostics = makeDiagnostics(
      "tool-missing",
      tool,
      platform,
      sdkRoots,
      candidates,
      executableCandidates,
    );
    throw new AndroidSdkToolError("tool-missing", tool, diagnostics);
  }
  return selected;
}

/** Resolve one tool to an executable path, never consulting PATH. */
export async function resolveAndroidSdkTool(
  tool: AndroidSdkTool,
  options: AndroidSdkResolverOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const sdkRoots = uniqueRoots(options);
  const candidates = (
    await Promise.all(sdkRoots.map((root) => toolCandidates(tool, root, platform)))
  ).flat();
  const executableCandidates: AndroidSdkToolCandidate[] = [];
  for (const candidate of candidates) {
    if (await isExecutable(candidate.path)) executableCandidates.push(candidate);
  }
  return selectCandidate(tool, platform, sdkRoots, candidates, executableCandidates).path;
}

/** Synchronous counterpart for Relay's raw screenshot/input bridge. */
export function resolveAndroidSdkToolSync(
  tool: AndroidSdkTool,
  options: AndroidSdkResolverOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const sdkRoots = uniqueRoots(options);
  const candidates = sdkRoots.flatMap((root) => toolCandidatesSync(tool, root, platform));
  const executableCandidates = candidates.filter((candidate) => isExecutableSync(candidate.path));
  return selectCandidate(tool, platform, sdkRoots, candidates, executableCandidates).path;
}

/** Resolve a complete audited toolchain in one pass for preflight/diagnostics. */
export async function resolveAndroidSdkTools(
  tools: readonly AndroidSdkTool[] = ANDROID_SDK_TOOLS,
  options: AndroidSdkResolverOptions = {},
): Promise<Record<AndroidSdkTool, string>> {
  const resolved = {} as Record<AndroidSdkTool, string>;
  for (const tool of tools) resolved[tool] = await resolveAndroidSdkTool(tool, options);
  return resolved;
}
