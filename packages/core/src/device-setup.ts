import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
import {
  DEFAULT_IOS_LIVE_PREVIEW,
  parseIosLivePreviewSettings,
  type IosLivePreviewSettings,
} from "./ios-live-preview.js";
import {
  inspectOperatorDesktopPackaging,
  type OperatorDesktopPackaging,
} from "./apple-operator-packaging.js";
import {
  inspectLabMacLaunchd,
  LAB_MAC_LAUNCHD_LABEL,
  type LabMacServerStatus,
} from "./lab-mac-server.js";
import {
  inspectOpenRouterJudgeSetup,
  type OpenRouterJudgeSetup,
} from "./openrouter-judge-setup.js";

const execFileAsync = promisify(execFile);
const DEVICE_SETUP_VERSION = 1 as const;
const DEVICE_SETUP_FILE = "device-setup.json";

/**
 * The few values Xcode needs to sign Relay's local XCTest helper for physical
 * iPhones and iPads. These are workspace settings, not shell prerequisites.
 * They contain identifiers only—never an Apple password or certificate.
 */
export type AppleDeviceSetup = {
  teamId: string;
  bundleId: string;
  /**
   * Advanced manual-signing overrides. Normal Relay setup deliberately leaves
   * both unset so Xcode can use automatic signing for the selected team.
   */
  signingIdentity?: string;
  provisioningProfile?: string;
};

export type DeviceSetup = {
  version: typeof DEVICE_SETUP_VERSION;
  ios?: AppleDeviceSetup;
  /** Live preview transport for physical Apple devices. Control stays on XCTest. */
  iosLivePreview?: IosLivePreviewSettings;
};

export type AppleSetupCheck = {
  id: "xcode" | "devicectl" | "account" | "signing" | "relay";
  label: string;
  status: "ready" | "needs-attention";
  detail: string;
};

export type AppleSetupStatus = {
  setup: DeviceSetup;
  checks: AppleSetupCheck[];
  suggestion?: AppleDeviceSetup & {
    /** A human-readable identity Relay found in the local keychain. */
    label: string;
  };
  /**
   * Signed operator .dmg, not the local XCTest runner.
   * Apple Development never makes this ready.
   */
  operatorBuild: OperatorDesktopPackaging;
  /**
   * Unattended lab Mac launchd job. Read-only — loading it restarts :8787.
   */
  labServer: LabMacServerStatus;
  /** Presence-only. Never includes OPENROUTER_API_KEY. */
  judgeProvider: OpenRouterJudgeSetup;
};

export type AndroidSetupStatus = {
  checks: Array<{
    id: "adb";
    label: string;
    status: "ready" | "needs-attention";
    detail: string;
  }>;
};

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAppleSetup(value: unknown): AppleDeviceSetup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const teamId = nonEmpty(record.teamId);
  const bundleId = nonEmpty(record.bundleId);
  if (!teamId || !bundleId) return undefined;
  // Manual signing is valid only when identity and provisioning profile are a
  // complete pair. Otherwise Xcode automatic signing remains authoritative.
  const signingIdentity = nonEmpty(record.signingIdentity);
  const provisioningProfile = nonEmpty(record.provisioningProfile);
  return {
    teamId,
    bundleId,
    ...(signingIdentity && provisioningProfile ? { signingIdentity, provisioningProfile } : {}),
  };
}

function parseDeviceSetup(value: unknown): DeviceSetup {
  if (!value || typeof value !== "object") return { version: DEVICE_SETUP_VERSION };
  const record = value as Record<string, unknown>;
  const ios = parseAppleSetup(record.ios);
  const iosLivePreview = parseIosLivePreviewSettings(record.iosLivePreview);
  return {
    version: DEVICE_SETUP_VERSION,
    ...(ios ? { ios } : {}),
    iosLivePreview,
  };
}

function validateAppleSetup(input: AppleDeviceSetup): AppleDeviceSetup {
  const teamId = input.teamId.trim();
  const bundleId = input.bundleId.trim();
  if (!/^[A-Za-z0-9]{6,32}$/.test(teamId)) {
    throw new Error("Apple Team ID must use letters and numbers only");
  }
  if (!/^[A-Za-z][A-Za-z0-9.-]{2,255}$/.test(bundleId)) {
    throw new Error("Runner bundle ID must be a reverse-domain identifier");
  }
  const signingIdentity = nonEmpty(input.signingIdentity);
  const provisioningProfile = nonEmpty(input.provisioningProfile);
  if (Boolean(signingIdentity) !== Boolean(provisioningProfile)) {
    throw new Error(
      "Manual signing needs both a signing identity and provisioning profile, or neither for Xcode automatic signing",
    );
  }
  return {
    teamId,
    bundleId,
    ...(signingIdentity ? { signingIdentity } : {}),
    ...(provisioningProfile ? { provisioningProfile } : {}),
  };
}

/** Signing env keys agent-device's daemon freezes at spawn time. */
const IOS_SIGNING_ENV_KEYS = [
  "AGENT_DEVICE_IOS_TEAM_ID",
  "AGENT_DEVICE_IOS_BUNDLE_ID",
  "AGENT_DEVICE_IOS_SIGNING_IDENTITY",
  "AGENT_DEVICE_IOS_PROVISIONING_PROFILE",
] as const;

/** Expected process.env projection for a saved Apple setup (empty = unset). */
export function expectedIosSigningEnv(
  setup: DeviceSetup,
): Record<(typeof IOS_SIGNING_ENV_KEYS)[number], string> {
  const ios = setup.ios;
  if (!ios) {
    return {
      AGENT_DEVICE_IOS_TEAM_ID: "",
      AGENT_DEVICE_IOS_BUNDLE_ID: "",
      AGENT_DEVICE_IOS_SIGNING_IDENTITY: "",
      AGENT_DEVICE_IOS_PROVISIONING_PROFILE: "",
    };
  }
  const manual = Boolean(ios.signingIdentity && ios.provisioningProfile);
  return {
    AGENT_DEVICE_IOS_TEAM_ID: ios.teamId,
    AGENT_DEVICE_IOS_BUNDLE_ID: ios.bundleId,
    AGENT_DEVICE_IOS_SIGNING_IDENTITY: manual ? ios.signingIdentity! : "",
    AGENT_DEVICE_IOS_PROVISIONING_PROFILE: ios.provisioningProfile ?? "",
  };
}

/** Make an already-saved setup available to agent-device in this server process. */
export function applyDeviceSetup(setup: DeviceSetup): void {
  const expected = expectedIosSigningEnv(setup);
  for (const key of IOS_SIGNING_ENV_KEYS) {
    const value = expected[key];
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
}

export async function readDeviceSetup(): Promise<DeviceSetup> {
  return parseDeviceSetup(await readWorkspaceSetting(DEVICE_SETUP_FILE));
}

export async function loadDeviceSetup(): Promise<DeviceSetup> {
  const setup = await readDeviceSetup();
  applyDeviceSetup(setup);
  return setup;
}

export async function saveAppleDeviceSetup(input: AppleDeviceSetup): Promise<DeviceSetup> {
  const current = await readDeviceSetup();
  const setup: DeviceSetup = {
    version: DEVICE_SETUP_VERSION,
    ios: validateAppleSetup(input),
    iosLivePreview: current.iosLivePreview ?? { ...DEFAULT_IOS_LIVE_PREVIEW },
  };
  await writeWorkspaceSetting(DEVICE_SETUP_FILE, setup);
  applyDeviceSetup(setup);
  return setup;
}

export async function saveIosLivePreviewSettings(
  input: IosLivePreviewSettings,
): Promise<DeviceSetup> {
  const current = await readDeviceSetup();
  const iosLivePreview = parseIosLivePreviewSettings(input);
  const setup: DeviceSetup = {
    version: DEVICE_SETUP_VERSION,
    ...(current.ios ? { ios: current.ios } : {}),
    iosLivePreview,
  };
  await writeWorkspaceSetting(DEVICE_SETUP_FILE, setup);
  applyDeviceSetup(setup);
  return setup;
}

export function resolveIosLivePreview(setup?: DeviceSetup): IosLivePreviewSettings {
  return setup?.iosLivePreview ?? { ...DEFAULT_IOS_LIVE_PREVIEW };
}

async function commandAvailable(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync(command, args, { timeout: 6_000, maxBuffer: 32 * 1024 });
    return `${result.stdout}\n${result.stderr}`.trim() || command;
  } catch {
    return null;
  }
}

type AppleSigningIdentity = {
  teamId: string;
  name: string;
};

export type XcodeProvisioningTeam = {
  teamId: string;
  name: string;
  personal: boolean;
};

/** Parse the accounts Xcode can actually provision with, not stale certificates. */
export function findXcodeProvisioningTeams(output: string | null): XcodeProvisioningTeam[] {
  if (!output) return [];
  const teams: XcodeProvisioningTeam[] = [];
  const seen = new Set<string>();
  const records = output.match(/\{[\s\S]*?teamID\s*=\s*[A-Z0-9]{6,32};[\s\S]*?\}/g) ?? [];
  for (const record of records) {
    const teamId = record.match(/teamID\s*=\s*([A-Z0-9]{6,32});/)?.[1]?.trim();
    const quotedName = record.match(/teamName\s*=\s*"([^"]+)";/)?.[1];
    const bareName = record.match(/teamName\s*=\s*([^;\n]+);/)?.[1];
    const name = (quotedName ?? bareName)?.trim();
    if (!teamId || !name || seen.has(teamId)) continue;
    seen.add(teamId);
    teams.push({
      teamId,
      name,
      personal: /isFreeProvisioningTeam\s*=\s*1;/.test(record) || /Personal Team/i.test(record),
    });
  }
  return teams;
}

/**
 * `security find-identity` already exposes the development team Xcode will use.
 * Keep this parser deliberately small and tolerant: it only turns a valid Apple
 * Development identity into an optional suggestion; setup still works when the
 * output changes or an account has no usable identity.
 */
export function findAppleSigningIdentities(output: string | null): AppleSigningIdentity[] {
  if (!output) return [];
  const identities: AppleSigningIdentity[] = [];
  const seenTeams = new Set<string>();
  const expression = /"((?:Apple Development|iPhone Developer):[^"\n]+?)\s*\(([A-Z0-9]{6,32})\)"/g;
  for (const match of output.matchAll(expression)) {
    const name = match[1]?.trim();
    const teamId = match[2]?.trim();
    if (!name || !teamId || seenTeams.has(teamId)) continue;
    seenTeams.add(teamId);
    identities.push({ teamId, name });
  }
  return identities;
}

function privateRunnerBundleId(teamId: string): string {
  return `com.relay.local.${teamId.toLowerCase()}.runner`;
}

export function suggestAppleDeviceSetup(
  identitiesOutput: string | null,
  xcodeTeamsOutput?: string | null,
): AppleSetupStatus["suggestion"] {
  const xcodeTeam = findXcodeProvisioningTeams(xcodeTeamsOutput ?? null)[0];
  if (xcodeTeam) {
    return {
      teamId: xcodeTeam.teamId,
      bundleId: privateRunnerBundleId(xcodeTeam.teamId),
      label: xcodeTeam.name,
    };
  }
  const identity = findAppleSigningIdentities(identitiesOutput)[0];
  if (!identity) return undefined;
  return {
    teamId: identity.teamId,
    bundleId: privateRunnerBundleId(identity.teamId),
    label: identity.name,
  };
}

/**
 * A lightweight, read-only check suitable for Settings. It deliberately does
 * not invoke a build or write into Xcode: the user opts into that by recording
 * on a physical iOS device.
 */
export async function inspectAppleDeviceSetup(): Promise<AppleSetupStatus> {
  const setup = await readDeviceSetup();
  const [xcode, devicectl, identities, xcodeTeamsOutput, labPrint] = await Promise.all([
    commandAvailable("xcodebuild", ["-version"]),
    // `devicectl version` is not a valid CoreDevice command in current Xcode.
    // Listing devices is fast, read-only, and confirms the command we actually
    // rely on for physical iPhone and iPad discovery.
    commandAvailable("xcrun", ["devicectl", "list", "devices"]),
    commandAvailable("security", ["find-identity", "-v", "-p", "codesigning"]),
    commandAvailable("defaults", ["read", "com.apple.dt.Xcode", "IDEProvisioningTeamByIdentifier"]),
    readLabMacLaunchdPrint(),
  ]);
  const availableIdentities = findAppleSigningIdentities(identities);
  const xcodeTeams = findXcodeProvisioningTeams(xcodeTeamsOutput);
  const matchingTeam = setup.ios
    ? xcodeTeams.find((team) => team.teamId === setup.ios?.teamId)
    : undefined;
  const suggestion = setup.ios ? undefined : suggestAppleDeviceSetup(identities, xcodeTeamsOutput);
  const hasDevelopmentIdentity = availableIdentities.length > 0;
  return {
    setup,
    checks: [
      {
        id: "xcode",
        label: "Xcode",
        status: xcode ? "ready" : "needs-attention",
        detail: xcode ? xcode.split("\n")[0]! : "Install Xcode and complete its first launch.",
      },
      {
        id: "devicectl",
        label: "Apple device support",
        status: devicectl ? "ready" : "needs-attention",
        detail: devicectl
          ? "Xcode can communicate with connected Apple devices."
          : "Open Xcode once, then return to Relay.",
      },
      {
        id: "account",
        label: "Xcode account",
        status: matchingTeam || (!setup.ios && xcodeTeams.length > 0) ? "ready" : "needs-attention",
        detail: matchingTeam
          ? `${matchingTeam.name} is available in Xcode.`
          : setup.ios
            ? "The selected Apple team is not available in Xcode. Choose an account that appears in Xcode Settings."
            : xcodeTeams.length > 0
              ? "Choose the Xcode account Relay should use."
              : "Open Xcode → Settings → Accounts and sign in to your Apple Developer account.",
      },
      {
        id: "signing",
        label: "Development certificate",
        status: hasDevelopmentIdentity ? "ready" : "needs-attention",
        detail: hasDevelopmentIdentity
          ? "Xcode has a development certificate available."
          : "Xcode will create a development certificate after you finish signing in.",
      },
      {
        id: "relay",
        label: "Relay runner",
        status: setup.ios && matchingTeam && hasDevelopmentIdentity ? "ready" : "needs-attention",
        detail: !matchingTeam
          ? "Choose an Apple team that is signed in to Xcode."
          : setup.ios
            ? "Relay will connect automatically when you choose this iPhone or iPad."
            : suggestion
              ? "Relay can use the Apple account already connected to Xcode."
              : "Sign into an Apple Developer account in Xcode, then check again.",
      },
    ],
    ...(suggestion ? { suggestion } : {}),
    operatorBuild: inspectOperatorDesktopPackaging(identities),
    labServer: inspectLabMacLaunchd(labPrint),
    judgeProvider: inspectOpenRouterJudgeSetup(),
  };
}

/** Read-only. Never `launchctl load` / `unload` — that restarts :8787. */
async function readLabMacLaunchdPrint(): Promise<string | null> {
  const uid = process.getuid?.();
  if (typeof uid !== "number") return null;
  try {
    const result = await execFileAsync(
      "launchctl",
      ["print", `gui/${uid}/${LAB_MAC_LAUNCHD_LABEL}`],
      {
        timeout: 6_000,
        maxBuffer: 32 * 1024,
      },
    );
    return `${result.stdout}\n${result.stderr}`.trim() || null;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    const text = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim();
    return text || null;
  }
}

/**
 * agent-device inherits Apple signing settings when its daemon starts. Stop
 * only that verified helper process after a team change so the next device
 * action starts it with the newly saved account. Other processes are ignored.
 */
export async function restartAgentDeviceDaemonForSetup(): Promise<boolean> {
  const stateDir = process.env.AGENT_DEVICE_STATE_DIR?.trim() || join(homedir(), ".agent-device");
  let canonicalPid: number | undefined;
  try {
    const value = JSON.parse(await readFile(join(stateDir, "daemon.json"), "utf8")) as {
      pid?: unknown;
      stateDir?: unknown;
    };
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 1)
      return false;
    if (typeof value.stateDir === "string" && value.stateDir !== stateDir) return false;
    canonicalPid = value.pid;
    const command = await commandAvailable("ps", ["-p", String(canonicalPid), "-o", "command="]);
    if (!command || !/agent-device\/.*internal\/daemon\.js/.test(command)) return false;
  } catch {
    return false;
  }

  // A crashed/restarted client can leave an orphan daemon behind after a new
  // daemon has replaced daemon.json. Reconcile every *verified* agent-device
  // daemon that declares this exact state directory; daemons for other
  // workspaces or test state directories remain untouched.
  const candidateOutput = await commandAvailable("pgrep", [
    "-f",
    "node_modules/agent-device/dist/src/internal/daemon.js",
  ]);
  const candidates = candidateOutput
    ?.split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1);
  const verified: number[] = [];
  for (const pid of candidates ?? []) {
    const command = await commandAvailable("ps", ["eww", "-p", String(pid), "-o", "command="]);
    if (command && agentDeviceDaemonPidsForStateDir(`${pid} ${command}`, stateDir).includes(pid)) {
      verified.push(pid);
    }
  }
  const pids = verified.length > 0 ? verified : [canonicalPid];
  if (!pids.includes(canonicalPid)) pids.push(canonicalPid);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // A daemon can exit between discovery and termination.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const alive = pids.some((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (!alive) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // The daemon owns long-lived native child processes and can remain stuck in
  // graceful shutdown after an Apple command times out. Every pid in this list
  // was resolved from daemon.json or verified against this exact stateDir, so
  // force-terminating only those processes is safer than allowing two daemons
  // to serve the same session store concurrently.
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // A daemon can finish graceful shutdown between the checks.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const alive = pids.some((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (!alive) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export function agentDeviceDaemonExecutable(command: string): string | undefined {
  return command.match(
    /(?:^|\s)(\S*node_modules\/agent-device\/dist\/src\/internal\/daemon\.js)(?:\s|$)/,
  )?.[1];
}

function currentAgentDeviceDaemonExecutable(): string {
  // createRequire tests in the native ESM source and in Electron's CJS server
  // bundle (whose build supplies import.meta.url). import.meta.resolve itself
  // is erased by a CommonJS bundle and made packaged recovery silently wrong.
  const entry = createRequire(import.meta.url).resolve("agent-device");
  return join(dirname(entry), "internal", "daemon.js");
}

/** Replace an orphaned daemon from another installed agent-device build.
 * Semver is insufficient because pnpm patches intentionally retain it while
 * changing the native command contract. Matching builds are never disturbed. */
export async function restartAgentDeviceDaemonForBuildDrift(): Promise<boolean> {
  const stateDir = process.env.AGENT_DEVICE_STATE_DIR?.trim() || join(homedir(), ".agent-device");
  try {
    const value = JSON.parse(await readFile(join(stateDir, "daemon.json"), "utf8")) as {
      pid?: unknown;
      stateDir?: unknown;
    };
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 1)
      return false;
    if (typeof value.stateDir === "string" && value.stateDir !== stateDir) return false;
    const command = await commandAvailable("ps", ["-p", String(value.pid), "-o", "command="]);
    const running = command ? agentDeviceDaemonExecutable(command) : undefined;
    if (!running || running === currentAgentDeviceDaemonExecutable()) return false;
    return restartAgentDeviceDaemonForSetup();
  } catch {
    return false;
  }
}

/**
 * agent-device freezes AGENT_DEVICE_IOS_* at daemon spawn. If the live daemon
 * still carries a shell signing identity (or an old team) that no longer
 * matches saved setup, force a restart so the next prepare inherits clean env.
 */
export async function restartAgentDeviceDaemonForSigningEnvDrift(
  setup?: DeviceSetup,
): Promise<boolean> {
  const resolved = setup ?? (await readDeviceSetup());
  applyDeviceSetup(resolved);
  const expected = expectedIosSigningEnv(resolved);
  const stateDir = process.env.AGENT_DEVICE_STATE_DIR?.trim() || join(homedir(), ".agent-device");
  try {
    const value = JSON.parse(await readFile(join(stateDir, "daemon.json"), "utf8")) as {
      pid?: unknown;
      stateDir?: unknown;
    };
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 1) {
      return false;
    }
    if (typeof value.stateDir === "string" && value.stateDir !== stateDir) return false;
    // `ps eww` includes the process environment on macOS/Linux.
    const command = await commandAvailable("ps", [
      "eww",
      "-p",
      String(value.pid),
      "-o",
      "command=",
    ]);
    if (!command || !/agent-device\/.*internal\/daemon\.js/.test(command)) return false;
    for (const key of IOS_SIGNING_ENV_KEYS) {
      const match = command.match(new RegExp(`${key}=([^\\s]+)`));
      const live = match?.[1] ?? "";
      const want = expected[key];
      if (live !== want) {
        return restartAgentDeviceDaemonForSetup();
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse `ps eww` output conservatively. Both the daemon executable and its
 * explicit state directory must match before Relay may terminate a process.
 */
export function agentDeviceDaemonPidsForStateDir(output: string, stateDir: string): number[] {
  const stateToken = `AGENT_DEVICE_STATE_DIR=${stateDir}`;
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) return [];
    const command = match[2]!;
    if (!/node_modules\/agent-device\/dist\/src\/internal\/daemon\.js(?:\s|$)/.test(command))
      return [];
    if (!command.split(/\s+/).includes(stateToken)) return [];
    const pid = Number(match[1]);
    return Number.isInteger(pid) && pid > 1 ? [pid] : [];
  });
}

/** Read-only availability check for Android Platform Tools. */
export async function inspectAndroidDeviceSetup(): Promise<AndroidSetupStatus> {
  let adbDiagnostic: string | undefined;
  const adbPath = await resolveAndroidSdkTool("adb").catch((error: unknown) => {
    adbDiagnostic = error instanceof Error ? error.message : String(error);
    return undefined;
  });
  const adb = adbPath ? await commandAvailable(adbPath, ["version"]) : null;
  return {
    checks: [
      {
        id: "adb",
        label: "Android Platform Tools",
        status: adb ? "ready" : "needs-attention",
        detail: adb
          ? adb.split("\n")[0]!
          : (adbDiagnostic ?? "Install Platform Tools, then reopen Relay so it can find adb."),
      },
    ],
  };
}
