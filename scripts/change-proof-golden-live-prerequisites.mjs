import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_TRACE_PACK_BYTES = 16 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/u;
const PROOF_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TSX_CLI = join(ROOT, "node_modules/tsx/dist/cli.mjs");

function bounded(value, max = 480) {
  return String(value ?? "").slice(0, max);
}

function commandResult(result) {
  return {
    code: Number.isInteger(result?.code) ? result.code : -1,
    stdout: bounded(result?.stdout, MAX_COMMAND_OUTPUT_BYTES),
    stderr: bounded(result?.stderr, MAX_COMMAND_OUTPUT_BYTES),
  };
}

export async function defaultCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: options.timeoutMs ?? 5_000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      cwd: ROOT,
    });
    return commandResult({ code: 0, ...result });
  } catch (error) {
    return commandResult({
      code: Number.isInteger(error?.code) ? error.code : Number(error?.status ?? -1),
      stdout: error?.stdout,
      stderr: error?.stderr ?? error?.message,
    });
  }
}

function blocker(id, reason, detail) {
  return Object.freeze({ id, reason, ...(detail ? { detail: bounded(detail) } : {}) });
}

async function regularFile(path, label, maxBytes) {
  if (!path) return { ok: false, error: `${label} was not supplied` };
  const resolved = resolve(path);
  try {
    const stat = await lstat(resolved);
    if (!stat.isFile()) return { ok: false, error: `${label} is not a regular file` };
    if (stat.size > maxBytes) return { ok: false, error: `${label} exceeds ${maxBytes} bytes` };
    return { ok: true, path: resolved, size: stat.size };
  } catch (error) {
    return { ok: false, error: `${label} is unavailable: ${bounded(error?.message ?? error)}` };
  }
}

function attachedAndroidSerials(output) {
  return String(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .map((line) => line.split(/\s+/u))
    .filter((fields) => fields.length >= 2)
    .map(([serial, status]) => ({ serial, status }))
    .filter(({ serial }) => Boolean(serial));
}

export async function inspectAndroidPrerequisites({
  env = process.env,
  command = defaultCommand,
} = {}) {
  const blockers = [];
  const serial = env.RELAY_GOLDEN_ANDROID_SERIAL?.trim();
  const appPath = env.RELAY_GOLDEN_ANDROID_APP_PATH?.trim();
  const appId = env.RELAY_GOLDEN_ANDROID_APP_ID?.trim();
  const appMapId = env.RELAY_GOLDEN_ANDROID_APP_MAP_ID?.trim();
  const testId = env.RELAY_GOLDEN_ANDROID_TEST_ID?.trim();
  const deviceProbe = await command("adb", ["devices", "-l"]);
  const devices = deviceProbe.code === 0 ? attachedAndroidSerials(deviceProbe.stdout) : [];
  if (deviceProbe.code !== 0)
    blockers.push(
      blocker(
        "android.adb.unavailable",
        "adb devices -l failed",
        deviceProbe.stderr || `exit ${deviceProbe.code}`,
      ),
    );
  if (!serial)
    blockers.push(
      blocker(
        "android.serial.missing",
        "RELAY_GOLDEN_ANDROID_SERIAL is required; refusing to choose a random device",
      ),
    );
  else {
    const selected = devices.find((device) => device.serial === serial);
    if (!selected || selected.status !== "device")
      blockers.push(
        blocker(
          "android.device.not-attached",
          `Android serial ${serial} is not attached and authorized`,
          devices.length
            ? devices.map(({ serial: id, status }) => `${id}:${status}`).join(", ")
            : "adb reported no attached devices",
        ),
      );
  }
  const fixture = await regularFile(appPath, "RELAY_GOLDEN_ANDROID_APP_PATH", 128 * 1024 * 1024);
  if (!fixture.ok) blockers.push(blocker("android.fixture-apk.missing", fixture.error));
  if (!appId)
    blockers.push(blocker("android.package-id.missing", "RELAY_GOLDEN_ANDROID_APP_ID is required"));
  if (!appMapId)
    blockers.push(
      blocker(
        "android.app-map.missing",
        "RELAY_GOLDEN_ANDROID_APP_MAP_ID is required; the device-free fixture ID is not a persisted map",
      ),
    );
  if (!testId)
    blockers.push(
      blocker(
        "android.test.missing",
        "RELAY_GOLDEN_ANDROID_TEST_ID is required; the device-free fixture ID is not a persisted Test",
      ),
    );
  let installed = false;
  if (
    serial &&
    appId &&
    devices.some(({ serial: id, status }) => id === serial && status === "device")
  ) {
    const packageProbe = await command("adb", ["-s", serial, "shell", "pm", "path", appId]);
    installed = packageProbe.code === 0 && /package:/u.test(packageProbe.stdout);
    if (!installed)
      blockers.push(
        blocker(
          "android.package.not-installed",
          `Android package ${appId} is not installed on ${serial}`,
          packageProbe.stderr || packageProbe.stdout,
        ),
      );
  }
  const emulatorProbe = await command("emulator", ["-list-avds"]);
  const avds =
    emulatorProbe.code === 0
      ? emulatorProbe.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  if (!devices.some(({ status }) => status === "device") && avds.length === 0)
    blockers.push(
      blocker(
        "android.runtime.none",
        "No authorized Android device and no Android emulator AVD are available",
        emulatorProbe.code === 0 ? "emulator -list-avds returned no AVDs" : emulatorProbe.stderr,
      ),
    );
  return {
    status: blockers.length === 0 ? "ready" : "unsupported",
    serial: serial ?? null,
    appId: appId ?? null,
    appMapId: appMapId ?? null,
    testId: testId ?? null,
    fixtureApk: fixture.ok ? { path: fixture.path, bytes: fixture.size } : null,
    installed,
    attached: devices,
    avds,
    blockers,
  };
}

export async function inspectManagedBrowserTargets({ env = process.env, targetFile } = {}) {
  const path =
    targetFile ?? join(env.RELAY_WORKSPACE_ROOT?.trim() || ROOT, ".relay", "targets.json");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return {
      status: "missing",
      path,
      browserTargetIds: [],
      blockers: [
        blocker(
          "browser.targets.registry.missing",
          "Managed browser target registry is unavailable",
          error?.message ?? error,
        ),
      ],
    };
  }
  if (!Array.isArray(parsed))
    return {
      status: "invalid",
      path,
      browserTargetIds: [],
      blockers: [
        blocker(
          "browser.targets.registry.invalid",
          "Managed browser target registry is not a JSON array",
        ),
      ],
    };
  const browserTargetIds = parsed
    .filter(
      (target) =>
        target &&
        typeof target === "object" &&
        target.kind === "browser" &&
        typeof target.id === "string",
    )
    .map((target) => target.id);
  const configured = env.RELAY_GOLDEN_WEB_TARGET_ID?.trim();
  const blockers =
    configured && !browserTargetIds.includes(configured)
      ? [
          blocker(
            "browser.target.configured.missing",
            `Configured managed browser target ${configured} is not present in ${path}`,
          ),
        ]
      : [];
  return {
    status: blockers.length ? "invalid" : browserTargetIds.length ? "ready" : "missing",
    path,
    browserTargetIds,
    configuredTargetId: configured || null,
    blockers,
  };
}

async function canonicalTracePackProjection(path) {
  const verifier = String.raw`
    import { readFile } from "node:fs/promises";
    import { analyzeTracePack, frozenRunFromTracePack, verifyTracePack } from "./packages/core/src/trace-pack.ts";
    (async () => {
    const value = JSON.parse(await readFile(process.env.RELAY_TRACE_PACK_FILE, "utf8"));
    const pack = verifyTracePack(value);
    const run = frozenRunFromTracePack(pack);
    const planArtifact = run.artifacts.filter((item) => item.kind === "app-map-test-plan");
    if (planArtifact.length !== 1) throw new Error("TracePack must contain exactly one App Map Test plan");
    const plan = planArtifact[0].data;
    if (!plan || typeof plan !== "object" || Array.isArray(plan) ||
        plan.schemaVersion !== 1 || typeof plan.appMapId !== "string" ||
        !Number.isInteger(plan.appMapRevision) || plan.appMapRevision < 1 ||
        !plan.test || typeof plan.test !== "object" || typeof plan.test.id !== "string") {
      throw new Error("TracePack App Map Test identity is invalid");
    }
    const analysis = analyzeTracePack(pack);
    process.stdout.write(JSON.stringify({
      digest: pack.digest,
      completeness: pack.completeness.status,
      historicalVerdict: analysis.historicalVerdict,
      run: {
        id: run.id,
        projectId: run.projectId ?? null,
        sourceRevision: run.sourceRevision ?? null,
        targetProfile: run.targetProfile ?? null,
        executionTarget: run.executionTarget ?? null,
        operationId: run.executionProvenance?.operationId ?? null,
        requestId: run.executionProvenance?.requestId ?? null
      },
      plan: { appMapId: plan.appMapId, testId: plan.test.id, appMapRevision: plan.appMapRevision }
    }));
  })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const result = await execFileAsync(process.execPath, [TSX_CLI, "--eval", verifier], {
    cwd: ROOT,
    env: { ...process.env, RELAY_TRACE_PACK_FILE: path },
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  return JSON.parse(result.stdout);
}

function sameValue(left, right) {
  return isDeepStrictEqual(left, right);
}

export async function inspectTracePack(path, artifactDir, phase, expected) {
  const file = await regularFile(
    path,
    `RELAY_GOLDEN_${phase.toUpperCase()}_TRACEPACK`,
    MAX_TRACE_PACK_BYTES,
  );
  if (!file.ok) return { status: "missing", error: file.error };
  let bytes;
  try {
    bytes = await readFile(file.path);
  } catch (error) {
    return { status: "missing", error: bounded(error?.message ?? error) };
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  let projection;
  try {
    projection = await canonicalTracePackProjection(file.path);
  } catch (error) {
    return {
      status: "invalid",
      digest,
      error: `Canonical TracePack verification failed: ${bounded(error?.stderr || error?.message || error)}`,
    };
  }
  const mismatches = [];
  if (projection.run.id !== expected?.runId) mismatches.push("run identity");
  if (projection.run.sourceRevision?.sha !== expected?.sourceSha) mismatches.push("source SHA");
  if (projection.run.sourceRevision?.artifactDigest !== expected?.artifactDigest)
    mismatches.push("build artifact digest");
  if (projection.plan.appMapId !== expected?.appMapId || projection.plan.testId !== expected?.testId)
    mismatches.push("App Map/Test identity");
  if (!sameValue(projection.run.targetProfile, expected?.targetProfile))
    mismatches.push("target profile");
  if (expected?.executionTarget && !sameValue(projection.run.executionTarget, expected.executionTarget))
    mismatches.push("execution target");
  if (mismatches.length) {
    return {
      status: "identity-mismatch",
      digest,
      error: `TracePack does not match declared ${phase} ${mismatches.join(", ")}`,
      projection,
    };
  }
  await mkdir(join(artifactDir, "tracepacks"), { recursive: true });
  const target = join(artifactDir, "tracepacks", `${phase}-${basename(file.path)}`);
  await copyFile(file.path, target);
  return {
    status: "verified",
    path: target,
    sourcePath: file.path,
    bytes: bytes.length,
    digest,
    canonicalDigest: projection.digest,
    projection,
  };
}

function parseJsonEnvironment(env, name) {
  const raw = env[name]?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function inspectExactProofInputs({ env = process.env, artifactDir }) {
  const blockers = [];
  const baseSha = env.RELAY_GOLDEN_BASE_HEAD?.trim() || null;
  const oldSha = env.RELAY_GOLDEN_OLD_HEAD?.trim() || null;
  const repairedSha = env.RELAY_GOLDEN_REPAIRED_HEAD?.trim() || null;
  for (const [name, value] of [
    ["base", baseSha],
    ["old", oldSha],
    ["repaired", repairedSha],
  ]) {
    if (!value || !SHA.test(value)) {
      const variable =
        name === "base" ? "BASE_HEAD" : name === "old" ? "OLD_HEAD" : "REPAIRED_HEAD";
      blockers.push(
        blocker(
          `proof.${name}-head.missing`,
          `RELAY_GOLDEN_${variable} must be a full 40-character lowercase SHA`,
        ),
      );
    }
  }
  const appMapId = env.RELAY_GOLDEN_ANDROID_APP_MAP_ID?.trim() || null;
  const testId = env.RELAY_GOLDEN_ANDROID_TEST_ID?.trim() || null;
  const expectedFor = (phase, sourceSha) => ({
    sourceSha,
    appMapId,
    testId,
    runId: env[`RELAY_GOLDEN_${phase.toUpperCase()}_RUN_ID`]?.trim() || null,
    artifactDigest:
      env[`RELAY_GOLDEN_${phase.toUpperCase()}_BUILD_DIGEST`]?.trim() || null,
    targetProfile: parseJsonEnvironment(
      env,
      `RELAY_GOLDEN_${phase.toUpperCase()}_TARGET_PROFILE`,
    ),
    executionTarget: parseJsonEnvironment(
      env,
      `RELAY_GOLDEN_${phase.toUpperCase()}_EXECUTION_TARGET`,
    ),
  });
  for (const phase of ["old", "repaired"]) {
    const upper = phase.toUpperCase();
    if (!env[`RELAY_GOLDEN_${upper}_RUN_ID`]?.trim())
      blockers.push(blocker(`proof.${phase}-run.missing`, `RELAY_GOLDEN_${upper}_RUN_ID is required`));
    if (!PROOF_DIGEST.test(env[`RELAY_GOLDEN_${upper}_BUILD_DIGEST`]?.trim() || ""))
      blockers.push(blocker(`proof.${phase}-build-digest.missing`, `RELAY_GOLDEN_${upper}_BUILD_DIGEST must be sha256:<64 lowercase hex>`));
    if (!parseJsonEnvironment(env, `RELAY_GOLDEN_${upper}_TARGET_PROFILE`))
      blockers.push(blocker(`proof.${phase}-target-profile.missing`, `RELAY_GOLDEN_${upper}_TARGET_PROFILE must be valid JSON`));
  }
  const oldTracePack = await inspectTracePack(
    env.RELAY_GOLDEN_OLD_TRACEPACK?.trim(),
    artifactDir,
    "old",
    expectedFor("old", oldSha),
  );
  const repairedTracePack = await inspectTracePack(
    env.RELAY_GOLDEN_REPAIRED_TRACEPACK?.trim(),
    artifactDir,
    "repaired",
    expectedFor("repaired", repairedSha),
  );
  for (const [phase, tracePack] of [
    ["old", oldTracePack],
    ["repaired", repairedTracePack],
  ]) {
    if (tracePack.status !== "verified")
      blockers.push(
        blocker(
          `proof.${phase}-tracepack.invalid`,
          tracePack.error || `Exact ${phase} TracePack is unavailable`,
        ),
      );
  }
  return {
    status: blockers.length === 0 ? "ready" : "unsupported",
    baseSha,
    oldSha,
    repairedSha,
    oldTracePack,
    repairedTracePack,
    blockers,
  };
}
