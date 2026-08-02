import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import type { Build } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
import type { TargetContext } from "./target-context.js";

const execFileAsync = promisify(execFile);

export type BuildCommandRunner = (
  executable: string,
  args: string[],
) => Promise<{ stdout?: string; stderr?: string }>;

const defaultCommandRunner: BuildCommandRunner = async (executable, args) => {
  const result = await execFileAsync(executable, args);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

export type RegisteredBuildPreflight = {
  buildId: string;
  ok: boolean;
  checkedAt: number;
  artifact?: { path: string; kind: "apk" | "app"; bytes?: number };
  applicationId?: string;
  capabilities: { install: boolean; launch: boolean };
  checks: Array<{
    id: string;
    status: "pass" | "warning" | "fail";
    message: string;
  }>;
};

function localArtifactPath(sourceUrl: string | undefined): string | undefined {
  const source = sourceUrl?.trim();
  if (!source) return undefined;
  if (/^https?:\/\//i.test(source)) return undefined;
  if (source.startsWith("file://")) {
    const url = new URL(source);
    return decodeURIComponent(url.pathname);
  }
  return isAbsolute(source) ? source : resolve(findWorkspaceRoot(), source);
}

async function inferApplicationId(
  build: Build,
  path: string,
  run: BuildCommandRunner,
): Promise<string | undefined> {
  const attempts: Array<[string, string[], (output: string) => string | undefined]> =
    build.platform === "android"
      ? [
          [
            "apkanalyzer",
            ["manifest", "application-id", path],
            (output) => output.trim() || undefined,
          ],
          [
            "aapt",
            ["dump", "badging", path],
            (output) => output.match(/package:\s+name='([^']+)'/)?.[1],
          ],
        ]
      : [
          [
            "plutil",
            ["-extract", "CFBundleIdentifier", "raw", `${path}/Info.plist`],
            (output) => output.trim() || undefined,
          ],
        ];
  for (const [command, args, parse] of attempts) {
    try {
      const result = await run(command, args);
      const applicationId = parse(String(result.stdout ?? ""));
      if (applicationId) return applicationId;
    } catch {
      // Tool availability is reflected as a launch warning in preflight.
    }
  }
  return undefined;
}

export async function preflightRegisteredBuild(
  build: Build,
  options: { target?: TargetContext; run?: BuildCommandRunner; at?: number } = {},
): Promise<RegisteredBuildPreflight> {
  const at = options.at ?? Date.now();
  const run = options.run ?? defaultCommandRunner;
  const path = localArtifactPath(build.sourceUrl);
  const expectedKind = build.platform === "android" ? "apk" : "app";
  const checks: RegisteredBuildPreflight["checks"] = [];
  if (!path) {
    checks.push({
      id: "local-artifact",
      status: "fail",
      message: build.sourceUrl
        ? "Build source is remote; register a local artifact before install"
        : "Build has no registered artifact",
    });
    return {
      buildId: build.id,
      ok: false,
      checkedAt: at,
      capabilities: { install: false, launch: false },
      checks,
    };
  }

  let info;
  try {
    await access(path);
    info = await stat(path);
  } catch {
    checks.push({
      id: "local-artifact",
      status: "fail",
      message: `Artifact does not exist: ${path}`,
    });
    return {
      buildId: build.id,
      ok: false,
      checkedAt: at,
      capabilities: { install: false, launch: false },
      checks,
    };
  }

  const kindMatches =
    expectedKind === "apk"
      ? info.isFile() && path.toLowerCase().endsWith(".apk")
      : info.isDirectory() && path.toLowerCase().endsWith(".app");
  checks.push({
    id: "artifact-format",
    status: kindMatches ? "pass" : "fail",
    message: kindMatches
      ? `Local ${expectedKind.toUpperCase()} is readable`
      : `Expected a local .${expectedKind} ${expectedKind === "app" ? "bundle" : "file"}`,
  });
  const targetMatches =
    !options.target ||
    (options.target.kind === "device" && options.target.platform === build.platform);
  checks.push({
    id: "target-platform",
    status: targetMatches ? "pass" : "fail",
    message: targetMatches
      ? `Build targets ${build.platform}`
      : `Selected target does not support this ${build.platform} build`,
  });

  const applicationId = kindMatches ? await inferApplicationId(build, path, run) : undefined;
  checks.push({
    id: "application-id",
    status: applicationId ? "pass" : "warning",
    message: applicationId
      ? `Application id: ${applicationId}`
      : "Application id could not be inferred; install is available but launch needs an explicit app id",
  });
  const install = kindMatches && targetMatches;
  return {
    buildId: build.id,
    ok: install,
    checkedAt: at,
    artifact: {
      path,
      kind: expectedKind,
      ...(info.isFile() ? { bytes: info.size } : {}),
    },
    ...(applicationId ? { applicationId } : {}),
    capabilities: { install, launch: install && Boolean(applicationId) },
    checks,
  };
}

export async function installRegisteredBuild(input: {
  build: Build;
  target: TargetContext;
  targetKind?: string | null;
  run?: BuildCommandRunner;
}): Promise<{ installed: true; applicationId?: string; artifactPath: string }> {
  const run = input.run ?? defaultCommandRunner;
  const preflight = await preflightRegisteredBuild(input.build, { target: input.target, run });
  if (!preflight.ok || !preflight.artifact) {
    throw new Error(
      preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; "),
    );
  }
  if (input.target.kind !== "device")
    throw new Error("Build installation requires a device target");
  if (input.target.platform === "android") {
    await run("adb", ["-s", input.target.serial, "install", "-r", preflight.artifact.path]);
  } else {
    if (input.targetKind && !/simulator/i.test(input.targetKind)) {
      throw new Error(
        "Local iOS build installation currently supports simulators; use a simulator or provider adapter",
      );
    }
    await run("xcrun", ["simctl", "install", input.target.serial, preflight.artifact.path]);
  }
  return {
    installed: true,
    ...(preflight.applicationId ? { applicationId: preflight.applicationId } : {}),
    artifactPath: preflight.artifact.path,
  };
}

export async function launchRegisteredBuild(input: {
  build: Build;
  target: TargetContext;
  applicationId?: string;
  run?: BuildCommandRunner;
}): Promise<{ launched: true; applicationId: string }> {
  const run = input.run ?? defaultCommandRunner;
  const preflight = await preflightRegisteredBuild(input.build, { target: input.target, run });
  if (!preflight.ok) {
    throw new Error(
      preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; "),
    );
  }
  const applicationId = input.applicationId?.trim() || preflight.applicationId;
  if (!applicationId)
    throw new Error("applicationId is required because it could not be inferred from the artifact");
  if (input.target.kind !== "device") throw new Error("Build launch requires a device target");
  if (input.target.platform === "android") {
    await run("adb", [
      "-s",
      input.target.serial,
      "shell",
      "monkey",
      "-p",
      applicationId,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
  } else {
    await run("xcrun", ["simctl", "launch", input.target.serial, applicationId]);
  }
  return { launched: true, applicationId };
}
