import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_TRACE_PACK_BYTES = 16 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/u;

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

async function inspectTracePack(path, artifactDir, phase) {
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
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return {
      status: "invalid",
      error: `TracePack is not JSON: ${bounded(error?.message ?? error)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { status: "invalid", digest, error: "TracePack root must be a JSON object" };
  await mkdir(join(artifactDir, "tracepacks"), { recursive: true });
  const target = join(artifactDir, "tracepacks", `${phase}-${basename(file.path)}`);
  await copyFile(file.path, target);
  return {
    status: "unverified",
    path: target,
    sourcePath: file.path,
    bytes: bytes.length,
    digest,
    warning: "TracePack bytes preserved; canonical Relay verification was not run",
  };
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
  const oldTracePack = await inspectTracePack(
    env.RELAY_GOLDEN_OLD_TRACEPACK?.trim(),
    artifactDir,
    "old",
  );
  const repairedTracePack = await inspectTracePack(
    env.RELAY_GOLDEN_REPAIRED_TRACEPACK?.trim(),
    artifactDir,
    "repaired",
  );
  for (const [phase, tracePack] of [
    ["old", oldTracePack],
    ["repaired", repairedTracePack],
  ]) {
    if (tracePack.status !== "unverified")
      blockers.push(
        blocker(
          `proof.${phase}-tracepack.invalid`,
          tracePack.error || `Exact ${phase} TracePack is unavailable`,
        ),
      );
    else
      blockers.push(
        blocker(
          `proof.${phase}-tracepack.unverified`,
          `Exact ${phase} TracePack was preserved but canonical Relay verification was not run`,
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
