import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";

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
  // Older Relay builds persisted the certificate discovered in Keychain even
  // though the runner uses Xcode automatic signing. An identity on its own is
  // not a valid manual-signing configuration and makes Xcode reject the
  // runner. Treat partial legacy overrides as absent during migration.
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
  return { version: DEVICE_SETUP_VERSION, ...(ios ? { ios } : {}) };
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

/** Make an already-saved setup available to agent-device in this server process. */
export function applyDeviceSetup(setup: DeviceSetup): void {
  const ios = setup.ios;
  if (!ios) return;
  process.env.AGENT_DEVICE_IOS_TEAM_ID = ios.teamId;
  process.env.AGENT_DEVICE_IOS_BUNDLE_ID = ios.bundleId;
  // Do not leak a certificate selected for discovery into automatic signing.
  // Xcode rejects CODE_SIGN_STYLE=Automatic combined with an explicit
  // CODE_SIGN_IDENTITY. Manual overrides are only valid as a complete pair.
  if (ios.signingIdentity && ios.provisioningProfile)
    process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY = ios.signingIdentity;
  else delete process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY;
  if (ios.provisioningProfile)
    process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE = ios.provisioningProfile;
  else delete process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE;
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
  const setup: DeviceSetup = { version: DEVICE_SETUP_VERSION, ios: validateAppleSetup(input) };
  await writeWorkspaceSetting(DEVICE_SETUP_FILE, setup);
  applyDeviceSetup(setup);
  return setup;
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
): AppleSetupStatus["suggestion"] {
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
  const [xcode, devicectl, identities] = await Promise.all([
    commandAvailable("xcodebuild", ["-version"]),
    // `devicectl version` is not a valid CoreDevice command in current Xcode.
    // Listing devices is fast, read-only, and confirms the command we actually
    // rely on for physical iPhone and iPad discovery.
    commandAvailable("xcrun", ["devicectl", "list", "devices"]),
    commandAvailable("security", ["find-identity", "-v", "-p", "codesigning"]),
  ]);
  const availableIdentities = findAppleSigningIdentities(identities);
  const matchingIdentity = setup.ios
    ? availableIdentities.find((identity) => identity.teamId === setup.ios?.teamId)
    : undefined;
  const suggestion = setup.ios ? undefined : suggestAppleDeviceSetup(identities);
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
        label: "Xcode signing identity",
        status:
          matchingIdentity || (!setup.ios && availableIdentities.length > 0)
            ? "ready"
            : "needs-attention",
        detail: matchingIdentity
          ? `Xcode can sign with ${matchingIdentity.name}.`
          : setup.ios
            ? "Open Xcode → Settings → Accounts and sign in to the Apple team selected in Relay."
            : availableIdentities.length > 0
              ? "Choose the development identity Relay should use."
              : "Open Xcode → Settings → Accounts and sign in to your Apple Developer account.",
      },
      {
        id: "signing",
        label: "Development certificate",
        status:
          identities && /\b[1-9]\d*\s+valid identities\b/i.test(identities)
            ? "ready"
            : "needs-attention",
        detail:
          identities && /\b[1-9]\d*\s+valid identities\b/i.test(identities)
            ? "A development certificate is in Keychain. Xcode account access is verified when Relay starts the runner."
            : "Sign into an Apple Developer account in Xcode.",
      },
      {
        id: "relay",
        label: "Relay runner",
        status: setup.ios && matchingIdentity ? "ready" : "needs-attention",
        detail: !matchingIdentity
          ? "Relay can create the runner after Xcode has a development identity for this team."
          : setup.ios
            ? `Relay will ask Xcode to sign ${setup.ios.bundleId} when you start recording.`
            : suggestion
              ? "Relay can finish setup with the Apple account found on this Mac."
              : "Sign into an Apple Developer account in Xcode, then check again.",
      },
    ],
    ...(suggestion ? { suggestion } : {}),
  };
}

/** Read-only availability check for Android Platform Tools. */
export async function inspectAndroidDeviceSetup(): Promise<AndroidSetupStatus> {
  const adb = await commandAvailable("adb", ["version"]);
  return {
    checks: [
      {
        id: "adb",
        label: "Android Platform Tools",
        status: adb ? "ready" : "needs-attention",
        detail: adb
          ? adb.split("\n")[0]!
          : "Install Platform Tools, then reopen Relay so it can find adb.",
      },
    ],
  };
}
