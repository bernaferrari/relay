import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "./errors.js";

export type ProjectKind =
  | "next"
  | "vite"
  | "web"
  | "expo"
  | "react-native"
  | "ios"
  | "android"
  | "unknown";

export type ProjectDetection = {
  kind: ProjectKind;
  evidence: string[];
  packageName?: string;
  devCommand?: string;
  frameworkPorts: number[];
};

export type InitResult = {
  kind: ProjectKind;
  detection: ProjectDetection;
  scaffold?: {
    url: string;
    urlSource: "explicit" | "running" | "script" | "framework-default";
    configPath: string;
    testPath: string;
    written: string[];
    kept: string[];
  };
  needsModelKey: boolean;
  nextSteps: string[];
  mobilePath?: string[];
  message?: string;
};

export type InitInput = {
  cwd: string;
  url?: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
};

export type InitDependencies = {
  probeUrl?(url: string): Promise<boolean>;
};

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PackageJson)
      : undefined;
  } catch {
    return undefined;
  }
}

function dependenciesOf(manifest: PackageJson | undefined): Set<string> {
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
}

function scriptText(manifest: PackageJson | undefined): string {
  return Object.values(manifest?.scripts ?? {}).join("\n");
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function hasIosProject(cwd: string): Promise<string | undefined> {
  const rootNames = await directoryNames(cwd);
  const rootProject = rootNames.find((name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"));
  if (rootProject) return rootProject;
  const iosNames = await directoryNames(join(cwd, "ios"));
  const iosProject = iosNames.find((name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"));
  return iosProject ? `ios/${iosProject}` : undefined;
}

async function hasAndroidProject(cwd: string): Promise<string | undefined> {
  if ((await exists(join(cwd, "android", "build.gradle"))) || (await exists(join(cwd, "android", "settings.gradle")))) {
    return "android";
  }
  if (
    (await exists(join(cwd, "settings.gradle"))) &&
    (await exists(join(cwd, "build.gradle"))) &&
    (await exists(join(cwd, "gradlew")))
  ) {
    return "settings.gradle";
  }
  return undefined;
}

function devCommand(manifest: PackageJson | undefined): string | undefined {
  const scripts = manifest?.scripts ?? {};
  for (const name of ["dev", "start", "serve"]) {
    if (scripts[name]) return `npm run ${name}`;
  }
  return undefined;
}

export async function detectProject(cwd: string): Promise<ProjectDetection> {
  const manifest = await readPackageJson(cwd);
  const dependencies = dependenciesOf(manifest);
  const scripts = scriptText(manifest);
  const evidence: string[] = [];
  if (manifest) evidence.push("package.json");
  const iosProject = await hasIosProject(cwd);
  const androidProject = await hasAndroidProject(cwd);

  let kind: ProjectKind = "unknown";
  if (dependencies.has("expo")) {
    kind = "expo";
    evidence.push("expo dependency");
  } else if (dependencies.has("react-native")) {
    kind = "react-native";
    evidence.push("react-native dependency");
  } else if (iosProject) {
    kind = "ios";
    evidence.push(iosProject);
  } else if (androidProject) {
    kind = "android";
    evidence.push(androidProject);
  } else if (dependencies.has("next") || /\bnext(?:\s+dev|\s+start)?\b/u.test(scripts)) {
    kind = "next";
    evidence.push(dependencies.has("next") ? "next dependency" : "next script");
  } else if (dependencies.has("vite") || /\bvite\b/u.test(scripts)) {
    kind = "vite";
    evidence.push(dependencies.has("vite") ? "vite dependency" : "vite script");
  } else if (manifest?.scripts?.dev || manifest?.scripts?.start || (await exists(join(cwd, "index.html")))) {
    kind = "web";
    evidence.push(manifest?.scripts?.dev || manifest?.scripts?.start ? "web start script" : "index.html");
  }

  return {
    kind,
    evidence,
    ...(typeof manifest?.name === "string" && manifest.name ? { packageName: manifest.name } : {}),
    ...(devCommand(manifest) ? { devCommand: devCommand(manifest) } : {}),
    frameworkPorts: kind === "next" ? [3000] : kind === "vite" ? [5173, 4173] : [],
  };
}

function scriptPort(manifest: PackageJson | undefined): number | undefined {
  const scripts = manifest?.scripts ?? {};
  for (const name of ["dev", "start", "serve"]) {
    const script = scripts[name];
    if (!script) continue;
    const match =
      /(?:^|\s)PORT=(\d{2,5})(?:\s|$)/u.exec(script) ??
      /(?:--port|-p)(?:=|\s+)(\d{2,5})(?:\s|$)/u.exec(script);
    if (!match) continue;
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  }
  return undefined;
}

async function defaultProbeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(350),
      redirect: "manual",
    });
    void response.body?.cancel().catch(() => {});
    return response.status < 500;
  } catch {
    return false;
  }
}

function normalizeExplicitUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`--url must be an absolute http(s) URL, got "${raw}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError("--url must use http or https");
  }
  if (url.username || url.password) {
    throw new UsageError("--url must not contain credentials");
  }
  url.hash = "";
  return url.toString();
}

function localUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

async function chooseUrl(
  detection: ProjectDetection,
  cwd: string,
  explicit: string | undefined,
  probe: (url: string) => Promise<boolean>,
): Promise<{ url: string; source: NonNullable<InitResult["scaffold"]>["urlSource"]; running: boolean } | undefined> {
  if (explicit) return { url: normalizeExplicitUrl(explicit), source: "explicit", running: await probe(explicit) };
  const candidates = [...detection.frameworkPorts, 3000, 5173, 4173, 8080, 8000]
    .filter((port, index, all) => all.indexOf(port) === index)
    .map(localUrl);
  const running = await Promise.all(candidates.map(async (url) => ((await probe(url)) ? url : undefined)));
  const runningUrl = running.find((url): url is string => Boolean(url));
  if (runningUrl) return { url: runningUrl, source: "running", running: true };

  if (detection.frameworkPorts.length) {
    const manifest = await readPackageJson(cwd);
    const configured = scriptPort(manifest);
    if (configured) return { url: localUrl(configured), source: "script", running: false };
    return { url: localUrl(detection.frameworkPorts[0]!), source: "framework-default", running: false };
  }
  return undefined;
}

function yamlFor(url: string): string {
  return `# Relay smoke test. Plain-English checks use Relay's model-backed runner.\nname: Home page loads\nurl: ${url}\nsteps:\n  - check: The home page renders without an error page\n`;
}

function configFor(url: string): string {
  return `${JSON.stringify({ device: "browser", url }, null, 2)}\n`;
}

function mobileSteps(kind: ProjectKind): string[] {
  if (kind === "ios") {
    return [
      "Open the iOS Simulator or connect a trusted device; iOS requires macOS and Xcode.",
      "Run relay devices and choose the exact iPhone or iPad.",
      "Record one short flow with relay guide record, save it, then run it with relay run or relay ci.",
    ];
  }
  if (kind === "android") {
    return [
      "Start an emulator or connect a device with USB debugging enabled; check adb devices.",
      "Run relay devices and choose the exact Android device.",
      "Record one short flow with relay guide record, save it, then run it with relay run or relay ci.",
    ];
  }
  return [
    "This JavaScript mobile app needs a running iOS simulator, Android emulator, or physical device plus the app build.",
    "Run relay devices and choose the exact target.",
    "Record one short flow with relay guide record, save it, then run it with relay run or relay ci.",
  ];
}

function nextSteps(input: {
  url: string;
  running: boolean;
  devCommand?: string;
  needsModelKey: boolean;
}): string[] {
  const steps: string[] = [];
  if (!input.running) steps.push(`Start the app: ${input.devCommand ?? "start your development server"}`);
  if (input.needsModelKey) steps.push("Set the model key: export OPENROUTER_API_KEY=<your OpenRouter key>");
  steps.push("Run the first check: relay ci .relay/tests --confirm");
  steps.push("Add Relay to Claude Code: claude mcp add relay -- npx -y @relay/mcp");
  return steps;
}

export async function runInitCommand(
  input: InitInput,
  dependencies: InitDependencies = {},
): Promise<InitResult> {
  const detection = await detectProject(input.cwd);
  const probe = dependencies.probeUrl ?? defaultProbeUrl;
  const needsModelKey = !input.env?.OPENROUTER_API_KEY;
  const mobile = ["expo", "react-native", "ios", "android"].includes(detection.kind) && !input.url;
  if (mobile) {
    return {
      kind: detection.kind,
      detection,
      needsModelKey,
      mobilePath: mobileSteps(detection.kind),
      nextSteps: [],
      message:
        "Detected a mobile project. relay init v1 does not bootstrap mobile apps automatically; it writes no files.",
    };
  }

  const chosen = await chooseUrl(detection, input.cwd, input.url, probe);
  if (!chosen) {
    return {
      kind: detection.kind,
      detection,
      needsModelKey,
      nextSteps: [
        "Start your local web server.",
        "Run relay init --url http://127.0.0.1:<port>",
      ],
      message:
        detection.kind === "unknown"
          ? "No web project or running localhost server was detected. Pass --url to initialize anyway."
          : "No running localhost server or framework default port was detected.",
    };
  }

  const relayDirectory = join(input.cwd, ".relay");
  const testsDirectory = join(relayDirectory, "tests");
  const configPath = join(relayDirectory, "config.json");
  const legacyConfigPath = join(input.cwd, "relay.json");
  const testPath = join(testsDirectory, "smoke.yaml");
  await mkdir(testsDirectory, { recursive: true });

  const written: string[] = [];
  const kept: string[] = [];
  if (!(await exists(configPath)) && !(await exists(legacyConfigPath))) {
    await writeFile(configPath, configFor(chosen.url), "utf8");
    written.push(".relay/config.json");
  } else if ((await exists(configPath)) && input.force) {
    await writeFile(configPath, configFor(chosen.url), "utf8");
    written.push(".relay/config.json");
  } else {
    kept.push((await exists(legacyConfigPath)) ? "relay.json" : ".relay/config.json");
  }

  if (!(await exists(testPath)) || input.force) {
    await writeFile(testPath, yamlFor(chosen.url), "utf8");
    written.push(".relay/tests/smoke.yaml");
  } else {
    kept.push(".relay/tests/smoke.yaml");
  }

  return {
    kind: detection.kind === "unknown" ? "web" : detection.kind,
    detection,
    scaffold: {
      url: chosen.url,
      urlSource: chosen.source,
      configPath: kept.includes("relay.json") ? "relay.json" : ".relay/config.json",
      testPath: ".relay/tests/smoke.yaml",
      written,
      kept,
    },
    needsModelKey,
    nextSteps: nextSteps({
      url: chosen.url,
      running: chosen.running,
      ...(detection.devCommand ? { devCommand: detection.devCommand } : {}),
      needsModelKey,
    }),
  };
}

function numbered(steps: readonly string[]): string[] {
  return steps.map((step, index) => `  ${index + 1}. ${step}`);
}

export function formatInitResult(result: InitResult): string {
  const lines: string[] = [];
  const label =
    result.kind === "next"
      ? "Next.js"
      : result.kind === "vite"
        ? "Vite"
        : result.kind === "web"
          ? "web"
          : result.kind;
  if (result.mobilePath) {
    lines.push(`Detected a ${label} project.`);
    lines.push(result.message ?? "Mobile initialization is not automatic in v1.");
    lines.push("Mobile path:");
    lines.push(...numbered(result.mobilePath));
    return lines.join("\n");
  }
  if (!result.scaffold) {
    lines.push(`Detected a ${label} project, but no usable localhost URL was found.`);
    if (result.message) lines.push(result.message);
    lines.push("Next:");
    lines.push(...numbered(result.nextSteps));
    return lines.join("\n");
  }

  lines.push(`Initialized Relay for a ${label} project at ${result.scaffold.url}`);
  if (result.scaffold.written.length) lines.push(`Wrote ${result.scaffold.written.join(", ")}`);
  if (result.scaffold.kept.length) lines.push(`Kept existing ${result.scaffold.kept.join(", ")}`);
  if (result.needsModelKey) {
    lines.push("The starter check is written in plain English and needs a model key to run.");
  }
  lines.push("Next:");
  lines.push(...numbered(result.nextSteps));
  return lines.join("\n");
}
