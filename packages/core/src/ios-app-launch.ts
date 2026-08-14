/**
 * Bring an iOS app to the foreground without the XCTest runner.
 * agent-device `apps.open` goes through CoreDevice with a 20s xcrun budget and
 * then the exclusive runner. When that path is wedged, launch still tests via
 * a short `devicectl` call or go-ios (after the iOS 17+ tunnel).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { findWorkspaceRoot } from "./workspace-root.js";

const execFileAsync = promisify(execFile);

export const IOS_SIDECAR_LAUNCH_TIMEOUT_MS = 10_000;
export const IOS_COREDEVICE_PROBE_TIMEOUT_MS = 5_000;
export const IOS_SESSION_PRIME_TIMEOUT_MS = 5_000;

/** Bind agent-device's XCTest session after a sidecar launch. Must not block forever. */
export async function primeIosAgentSession(
  open: () => Promise<unknown>,
  timeoutMs = IOS_SESSION_PRIME_TIMEOUT_MS,
): Promise<void> {
  await Promise.race([
    open(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("iOS session prime timed out")), timeoutMs);
    }),
  ]);
}

export type CommandResult = { exitCode: number; stdout: string; stderr: string };

export type CommandRunner = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<CommandResult>;

const BUNDLE_ALIASES: Record<string, string> = {
  grok: "ai.x.GrokApp",
  "ai.x.grok": "ai.x.GrokApp",
  "ai.x.grokapp": "ai.x.GrokApp",
  settings: "com.apple.Preferences",
  safari: "com.apple.mobilesafari",
  preferences: "com.apple.Preferences",
  "com.apple.preferences": "com.apple.Preferences",
  springboard: "com.apple.springboard",
  home: "com.apple.springboard",
};

let tunnelChild: ChildProcess | null = null;
let cachedTunnelInfoPort: string | undefined;
const DEFAULT_TUNNEL_INFO_PORT = "28100";
const FALLBACK_TUNNEL_INFO_PORTS = ["28100", "60105"] as const;

function envTunnelInfoPort(): string | undefined {
  const port =
    process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT?.trim() ||
    process.env.GO_IOS_TUNNEL_INFO_PORT?.trim() ||
    "";
  return /^\d+$/.test(port) ? port : undefined;
}

/** Userspace tunnels often advertise info on a non-default port (not 28100). */
export function goIosTunnelInfoArgs(): string[] {
  const port = envTunnelInfoPort() || cachedTunnelInfoPort;
  if (!port) return [];
  return ["--tunnel-info-port", port];
}

export function resetGoIosTunnelInfoPortForTests(): void {
  cachedTunnelInfoPort = undefined;
}

export async function probeGoIosTunnelInfoPort(
  port: string,
  probe?: (port: string) => Promise<boolean>,
): Promise<boolean> {
  if (probe) return probe(port);
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(250) });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|fetch failed/i.test(message) && /refused/i.test(message)) return false;
    // A hang/timeout is the userspace tun data port, not the info API.
    return /ECONNRESET|reset/i.test(message);
  }
}

export async function rememberGoIosTunnelInfoPort(
  input: { probe?: (port: string) => Promise<boolean> } = {},
): Promise<string | undefined> {
  const fromEnv = envTunnelInfoPort();
  if (fromEnv) {
    cachedTunnelInfoPort = fromEnv;
    return fromEnv;
  }
  if (cachedTunnelInfoPort) return cachedTunnelInfoPort;
  for (const port of FALLBACK_TUNNEL_INFO_PORTS) {
    if (await probeGoIosTunnelInfoPort(port, input.probe)) {
      cachedTunnelInfoPort = port;
      return port;
    }
  }
  return undefined;
}

function withGoIosDeviceArgs(args: readonly string[]): string[] {
  const extra = goIosTunnelInfoArgs();
  if (extra.length === 0 || args.includes("--tunnel-info-port")) return [...args];
  return [...args, ...extra];
}

/**
 * CoreDevice process listing and XCTest launch hang when the developer disk
 * image is wedged. Remount via go-ios; do not reboot the iPad.
 */
export async function remountIosDeveloperDiskImage(
  serial: string,
  input: { bin?: string; run?: CommandRunner; timeoutMs?: number } = {},
): Promise<boolean> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 45_000;
  const bin = input.bin ?? (await resolveGoIosBinary());
  await rememberGoIosTunnelInfoPort();
  await runGoIos(bin, ["image", "unmount", "--udid", serial], Math.min(timeoutMs, 15_000), run);
  const mounted = await runGoIos(bin, ["image", "auto", "--udid", serial], timeoutMs, run);
  const text = `${mounted.stdout}\n${mounted.stderr}`;
  const ok = mounted.exitCode === 0 && /success mounting|image signature/i.test(text);
  return ok;
}

export function resolveIosLaunchBundleId(app: string): string {
  const trimmed = app.trim();
  if (!trimmed) throw new Error("iOS launch requires an app name or bundle id");
  const alias = BUNDLE_ALIASES[trimmed.toLocaleLowerCase()];
  if (alias) return alias;
  if (trimmed.includes(".")) return trimmed;
  throw new Error(
    `“${trimmed}” is not a known iOS app. Use a bundle id such as com.apple.Preferences.`,
  );
}

export function isIosSidecarTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /xcrun timed out|devicectl timed out|go-ios .*timed out|timed out after \d+ms/i.test(
    message,
  );
}

export async function defaultCommandRunner(
  file: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, [...args], {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  } catch (error) {
    const err = error as {
      code?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      status?: number | null;
      message?: string;
    };
    if (err.code === "ETIMEDOUT" || err.killed) {
      throw new Error(`${file} timed out after ${timeoutMs}ms`);
    }
    return {
      exitCode: typeof err.status === "number" ? err.status : 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
    };
  }
}

export async function probeIosCoreDevice(
  serial: string,
  input: { run?: CommandRunner; timeoutMs?: number } = {},
): Promise<void> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? IOS_COREDEVICE_PROBE_TIMEOUT_MS;
  const output = join(tmpdir(), `relay-ios-probe-${process.pid}-${Date.now()}.json`);
  const result = await run(
    "xcrun",
    ["devicectl", "device", "info", "processes", "--device", serial, "--json-output", output],
    timeoutMs,
  );
  if (result.exitCode === 0) return;
  const detail = `${result.stdout}\n${result.stderr}`.trim() || `exit ${result.exitCode}`;
  throw new Error(`Apple device control is not answering (${detail.slice(0, 180)})`);
}

export async function launchIosAppViaDevicectl(
  serial: string,
  app: string,
  input: { relaunch?: boolean; run?: CommandRunner; timeoutMs?: number } = {},
): Promise<{ bundleId: string; method: "devicectl" }> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? IOS_SIDECAR_LAUNCH_TIMEOUT_MS;
  const bundleId = resolveIosLaunchBundleId(app);
  const args = [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    serial,
    ...(input.relaunch === false ? [] : ["--terminate-existing"]),
    bundleId,
  ];
  let result = await run("xcrun", args, timeoutMs);
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    result.exitCode !== 0 &&
    /unrecognized|unknown option|unexpected argument.*terminate/i.test(text)
  ) {
    result = await run(
      "xcrun",
      ["devicectl", "device", "process", "launch", "--device", serial, bundleId],
      timeoutMs,
    );
  }
  if (result.exitCode === 0) return { bundleId, method: "devicectl" };
  throw new Error(
    `${result.stderr || result.stdout || `devicectl launch exited ${result.exitCode}`}`.trim(),
  );
}

export async function resolveGoIosBinary(): Promise<string> {
  const fromEnv = process.env.RELAY_GO_IOS_BIN?.trim() || process.env.GO_IOS_BIN?.trim();
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    join(findWorkspaceRoot(), "vendor", "go-ios", "bin", "ios"),
  ];
  for (const candidate of candidates) {
    const path = isAbsolute(candidate) ? candidate : join(process.cwd(), candidate);
    try {
      await access(path);
      return path;
    } catch {
      // next
    }
  }
  throw new Error("go-ios binary not found (set RELAY_GO_IOS_BIN)");
}

async function runGoIos(
  bin: string,
  args: string[],
  timeoutMs: number,
  run: CommandRunner,
): Promise<CommandResult> {
  return run(bin, withGoIosDeviceArgs(args), timeoutMs);
}

function tunnelLooksReady(listed: string): boolean {
  return /"udid"\s*:/.test(listed) || /userspaceTun/.test(listed) || /rsdPort/.test(listed);
}

export async function ensureGoIosTunnel(
  input: { bin?: string; run?: CommandRunner } = {},
): Promise<void> {
  const bin = input.bin ?? (await resolveGoIosBinary());
  const run = input.run ?? defaultCommandRunner;
  await rememberGoIosTunnelInfoPort();
  try {
    const listed = await runGoIos(bin, ["tunnel", "ls"], 5_000, run);
    if (tunnelLooksReady(`${listed.stdout}\n${listed.stderr}`)) return;
  } catch {
    // start below
  }
  if (!tunnelChild || tunnelChild.exitCode != null) {
    // Pin the info API on the go-ios default so clients stop needing 60105 folklore.
    tunnelChild = spawn(
      bin,
      ["tunnel", "start", "--userspace", "--tunnel-info-port", DEFAULT_TUNNEL_INFO_PORT],
      {
        stdio: "ignore",
        env: { ...process.env, ENABLE_GO_IOS_AGENT: process.env.ENABLE_GO_IOS_AGENT || "user" },
        detached: false,
      },
    );
    tunnelChild.unref?.();
    tunnelChild.once("exit", () => {
      if (tunnelChild?.exitCode != null) tunnelChild = null;
    });
    cachedTunnelInfoPort = DEFAULT_TUNNEL_INFO_PORT;
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const listed = await runGoIos(bin, ["tunnel", "ls"], 4_000, run);
      if (tunnelLooksReady(`${listed.stdout}\n${listed.stderr}`)) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("go-ios tunnel did not become ready");
}

export async function launchIosAppViaGoIos(
  serial: string,
  app: string,
  input: { run?: CommandRunner; timeoutMs?: number; bin?: string } = {},
): Promise<{ bundleId: string; method: "go-ios" }> {
  const bundleId = resolveIosLaunchBundleId(app);
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? IOS_SIDECAR_LAUNCH_TIMEOUT_MS;
  const bin = input.bin ?? (await resolveGoIosBinary());
  const attempt = () => runGoIos(bin, ["launch", bundleId, "--udid", serial], timeoutMs, run);
  let result = await attempt();
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0 && /tunnel|ios17|rsd/i.test(text)) {
    await ensureGoIosTunnel({ bin, run });
    result = await attempt();
  }
  if (result.exitCode === 0) return { bundleId, method: "go-ios" };
  throw new Error(
    (result.stderr || result.stdout || `go-ios launch exited ${result.exitCode}`).trim(),
  );
}

const STALE_IOS_TEST_PROCESS_NAMES = [
  "AgentDeviceRunner",
  "AgentDeviceRunnerUITests-Runner",
  "devicekit-iosUITests-Runner",
  "xctest",
  "testmanagerd",
] as const;

/**
 * A wedged XCTest host can sit for days holding UI Automation. New xcodebuild
 * then hangs until reboot. Instruments kill via go-ios does not need XCTest.
 */
export async function killStaleIosTestRunners(
  serial: string,
  input: { run?: CommandRunner; bin?: string; timeoutMs?: number } = {},
): Promise<string[]> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const bin = input.bin ?? (await resolveGoIosBinary());
  const killed: string[] = [];
  for (const name of STALE_IOS_TEST_PROCESS_NAMES) {
    const result = await runGoIos(
      bin,
      ["kill", "--process", name, "--udid", serial],
      timeoutMs,
      run,
    );
    const text = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode === 0 && /killed/i.test(text)) killed.push(name);
  }
  return killed;
}

/** Cheap identity for “did the pixels move?” after an XCTest tap. */
export function pixelEvidenceFingerprint(bytes: Uint8Array): string {
  let hash = bytes.length >>> 0;
  const step = bytes.length > 8_192 ? 97 : 1;
  for (let i = 0; i < bytes.length; i += step) {
    hash = Math.imul(hash ^ bytes[i]!, 16_777_619);
  }
  if (bytes.length > 0) hash = Math.imul(hash ^ bytes[bytes.length - 1]!, 16_777_619);
  return `${bytes.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

export async function verifyIosScreenChanged(
  serial: string,
  act: () => Promise<void>,
  input: { run?: CommandRunner; bin?: string } = {},
): Promise<void> {
  const bin = input.bin ?? (await resolveGoIosBinary());
  const run = input.run ?? defaultCommandRunner;
  const beforePath = join(tmpdir(), `relay-tap-before-${process.pid}-${Date.now()}.png`);
  const afterPath = join(tmpdir(), `relay-tap-after-${process.pid}-${Date.now()}.png`);
  await captureIosPngViaGoIos(serial, beforePath, { bin, run, timeoutMs: 8_000 });
  const beforeHash = pixelEvidenceFingerprint(await readFile(beforePath));
  await act();
  await new Promise((resolve) => setTimeout(resolve, 280));
  await captureIosPngViaGoIos(serial, afterPath, { bin, run, timeoutMs: 8_000 });
  const afterHash = pixelEvidenceFingerprint(await readFile(afterPath));
  if (afterHash === beforeHash) {
    throw new Error(
      "Tap did not change the screen. The control may not be hittable there — tap the label, or pick another point.",
    );
  }
}

export async function captureIosPngViaGoIos(
  serial: string,
  path: string,
  input: { run?: CommandRunner; timeoutMs?: number; bin?: string } = {},
): Promise<void> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 12_000;
  const bin = input.bin ?? (await resolveGoIosBinary());
  const attempt = () =>
    runGoIos(bin, ["screenshot", "--udid", serial, `--output=${path}`], timeoutMs, run);
  let result = await attempt();
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0 && /tunnel|ios17|rsd/i.test(text)) {
    await ensureGoIosTunnel({ bin, run });
    result = await attempt();
  }
  if (result.exitCode !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `go-ios screenshot exited ${result.exitCode}`).trim(),
    );
  }
}

export async function launchIosAppOutsideXctest(
  serial: string,
  app: string,
  input: { relaunch?: boolean; run?: CommandRunner; timeoutMs?: number; bin?: string } = {},
): Promise<{ bundleId: string; method: "devicectl" | "go-ios" }> {
  try {
    return await launchIosAppViaDevicectl(serial, app, input);
  } catch (devicectlError) {
    try {
      return await launchIosAppViaGoIos(serial, app, input);
    } catch {
      throw devicectlError;
    }
  }
}
