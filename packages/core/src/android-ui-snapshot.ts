import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
import type { SnapshotNode } from "./device.js";

const execFileAsync = promisify(execFile);

type AndroidAdbExecOptions = {
  timeout?: number;
  maxBuffer?: number;
  encoding?: BufferEncoding;
};

async function execAndroidAdb(args: string[], options: AndroidAdbExecOptions = {}) {
  return execFileAsync(await resolveAndroidSdkTool("adb"), args, options);
}

type Attributes = Record<string, string>;

const NON_APPLICATION_PACKAGES = new Set([
  "com.android.systemui",
  "com.google.android.inputmethod.latin",
  "com.samsung.android.honeyboard",
  "com.touchtype.swiftkey",
]);

/** Whether Android's accessibility tree can be painted over the captured pixels. */
export type AndroidInspectionState = "active" | "keyguard" | "asleep" | "unavailable" | "unknown";

/**
 * Android can expose an old or privacy-redacted accessibility hierarchy while
 * the keyguard owns the display. Those nodes are not safe to paint over a
 * mirrored frame: they can describe the app that was open before locking.
 */
export function androidInspectionState(policy: string): AndroidInspectionState {
  const keyguardShowing = /(?:^|\n)\s*showing=true\b/.test(policy);
  const screenOff = /screenState=SCREEN_STATE_(?:OFF|UNKNOWN)\b/.test(policy);
  const asleep = /interactiveState=INTERACTIVE_STATE_(?:SLEEP|OFF)\b/.test(policy);
  if (screenOff || asleep) return "asleep";
  if (keyguardShowing) return "keyguard";
  return "active";
}

export function androidScreenIsInspectable(policy: string): boolean {
  return androidInspectionState(policy) === "active";
}

export async function wakeAndroidDisplay(serial: string): Promise<void> {
  await execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"], {
    timeout: 2_000,
  });
}

export async function captureAndroidInspectionState(
  serial: string,
): Promise<AndroidInspectionState> {
  try {
    const { stdout } = await execAndroidAdb(
      ["-s", serial, "shell", "dumpsys", "window", "policy"],
      { timeout: 2_000, maxBuffer: 512 * 1024 },
    );
    return androidInspectionState(stdout);
  } catch {
    // A diagnostics query must never make a controllable device disappear.
    // If it is unavailable, take the normal snapshot and let its own result
    // determine whether inspection can be shown.
    return "unknown";
  }
}

/** Parse Android's authoritative resumed activity into its owning package. */
export function parseAndroidForegroundApp(output: string): string | undefined {
  const activity =
    /(?:topResumedActivity|mResumedActivity)=ActivityRecord\{[^\n]*?\bu\d+\s+([A-Za-z0-9._-]+)\//.exec(
      output,
    );
  return activity?.[1];
}

/** Read the app that owns the pixels currently shown on the physical display. */
export async function captureAndroidForegroundApp(serial: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAndroidAdb(
      ["-s", serial, "shell", "dumpsys", "activity", "activities"],
      { timeout: 2_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return parseAndroidForegroundApp(stdout);
  } catch {
    return undefined;
  }
}

/** App represented by an Android hierarchy, excluding system overlays and IMEs. */
export function androidSnapshotApplication(nodes: SnapshotNode[]): string | undefined {
  const owners = nodes
    .map((node) => node.bundleId?.trim())
    .filter(
      (owner): owner is string =>
        typeof owner === "string" && owner.length > 0 && !NON_APPLICATION_PACKAGES.has(owner),
    );
  if (owners.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const owner of owners) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

export function androidSnapshotMatchesForeground(
  nodes: SnapshotNode[],
  foregroundApp: string | undefined,
): boolean {
  const treeApp = androidSnapshotApplication(nodes);
  return !foregroundApp || !treeApp || treeApp === foregroundApp;
}

/**
 * Accessibility can briefly keep an old app window active after Android has
 * foregrounded another activity. Never bind those stale controls to the new
 * app's pixels: a pixels-only frame is safer and remains fully controllable by
 * coordinate until the next semantic snapshot catches up.
 */
export function androidSnapshotNodesForForeground(
  nodes: SnapshotNode[],
  foregroundApp: string | undefined,
): SnapshotNode[] {
  return androidSnapshotMatchesForeground(nodes, foregroundApp) ? nodes : [];
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributes(source: string): Attributes {
  const result: Attributes = {};
  const match = /([\w-]+)="([^"]*)"/g;
  let item: RegExpExecArray | null;
  while ((item = match.exec(source))) {
    const [, key, value] = item;
    if (key && value !== undefined) result[key] = decodeXml(value);
  }
  return result;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function bounds(value: string | undefined): SnapshotNode["rect"] | undefined {
  const match = value && /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value);
  if (!match) return undefined;
  const [, left, top, right, bottom] = match;
  const x = Number(left);
  const y = Number(top);
  const width = Number(right) - x;
  const height = Number(bottom) - y;
  return Number.isFinite(x) && Number.isFinite(y) && width >= 0 && height >= 0
    ? { x, y, width, height }
    : undefined;
}

/**
 * Convert Android's dependency-free `uiautomator dump` XML into Relay's
 * snapshot shape. This deliberately retains the same semantic fields used by
 * the live overlay and recorded evidence, without requiring an app session.
 */
export function parseAndroidUiSnapshot(xml: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  const parentStack: number[] = [];
  const tag = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(xml))) {
    if (match[0] === "</node>") {
      parentStack.pop();
      continue;
    }
    const attrs = attributes(match[1] ?? "");
    const rect = bounds(attrs.bounds);
    const text = attrs.text?.trim();
    const description = attrs["content-desc"]?.trim();
    const label = description || text;
    const clickable = bool(attrs.clickable) === true;
    const focusable = bool(attrs.focusable) === true;
    const longClickable = bool(attrs["long-clickable"]) === true;
    const scrollable = bool(attrs.scrollable) === true;
    const index = nodes.length;
    nodes.push({
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(text ? { value: text } : {}),
      ...(attrs["resource-id"] ? { identifier: attrs["resource-id"] } : {}),
      ...(attrs.class ? { role: attrs.class } : {}),
      ...(attrs.package ? { bundleId: attrs.package } : {}),
      ...(bool(attrs.enabled) !== undefined ? { enabled: bool(attrs.enabled) } : {}),
      ...(bool(attrs.selected) !== undefined ? { selected: bool(attrs.selected) } : {}),
      ...(bool(attrs.focused) !== undefined ? { focused: bool(attrs.focused) } : {}),
      ...(bool(attrs["visible-to-user"]) !== undefined
        ? { visibleToUser: bool(attrs["visible-to-user"]) }
        : {}),
      ...(clickable || focusable || longClickable || scrollable ? { hittable: true } : {}),
      ...(rect ? { rect } : {}),
      index,
      ...(parentStack.length ? { parentIndex: parentStack[parentStack.length - 1] } : {}),
    });
    if (match[2] !== "/") parentStack.push(index);
  }

  return nodes;
}

export type AndroidUiSnapshot = {
  nodes: SnapshotNode[];
  inspectionState: AndroidInspectionState;
};

const ANDROID_SNAPSHOT_HELPER_PACKAGE = "com.callstack.agentdevice.snapshothelper";
const ANDROID_SNAPSHOT_HELPER_COMPONENT = `${ANDROID_SNAPSHOT_HELPER_PACKAGE}/.SnapshotInstrumentation`;

/**
 * Decode chunked `am instrument` output from the already-installed snapshot
 * helper. Stock `uiautomator dump` uses getRootInActiveWindow() and returns a
 * null root on Samsung (and others) whenever a third-party accessibility
 * service is bound. The helper reads every interactive window instead.
 */
export function parseAndroidSnapshotHelperInstrumentation(output: string): string | undefined {
  const chunks = new Map<number, string>();
  let expected = 0;
  let record: Record<string, string> = {};
  let ok = false;

  const flush = () => {
    if (
      record.agentDeviceProtocol === "android-snapshot-helper-v1" &&
      record.outputFormat === "uiautomator-xml" &&
      record.payloadBase64
    ) {
      const index = Number(record.chunkIndex);
      const count = Number(record.chunkCount);
      if (Number.isInteger(index) && index >= 0) chunks.set(index, record.payloadBase64);
      if (Number.isInteger(count) && count > 0) expected = count;
    }
    if (record.ok === "true") ok = true;
    record = {};
  };

  for (const line of output.split(/\r?\n/)) {
    if (
      line.startsWith("INSTRUMENTATION_STATUS: ") ||
      line.startsWith("INSTRUMENTATION_RESULT: ")
    ) {
      const body = line.slice(line.indexOf(": ") + 2);
      const eq = body.indexOf("=");
      if (eq > 0) record[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (
      line.startsWith("INSTRUMENTATION_STATUS_CODE:") ||
      line.startsWith("INSTRUMENTATION_CODE:")
    ) {
      flush();
    }
  }
  flush();
  if (!ok || expected < 1 || chunks.size !== expected) return undefined;
  const parts: Buffer[] = [];
  for (let index = 0; index < expected; index += 1) {
    const payload = chunks.get(index);
    if (!payload) return undefined;
    parts.push(Buffer.from(payload, "base64"));
  }
  const xml = Buffer.concat(parts).toString("utf8");
  return xml.includes("<hierarchy") && xml.includes("</hierarchy>") ? xml : undefined;
}

function execFileOutput(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const body = error as { stdout?: unknown; stderr?: unknown };
  return `${typeof body.stdout === "string" ? body.stdout : ""}\n${
    typeof body.stderr === "string" ? body.stderr : ""
  }`;
}

const ANDROID_DUMP_PATH = "/data/local/tmp/relay-uidump.xml";
const dumpBlockedSerials = new Set<string>();

export type AndroidSnapshotBackend = "helper" | "dump";

export type AndroidSnapshotOwnership = {
  /** Live helper / instrumentation process already registered UiAutomation. */
  helperProcessRunning: boolean;
  /** Helper package is installed or the bundled APK can be installed. */
  helperAvailable: boolean;
  /** Dump already died with 137 / already-registered on this serial. */
  dumpBlocked: boolean;
};

/**
 * Android allows one UiAutomation owner. The snapshot helper is that owner
 * once it is alive; stock `uiautomator dump` then exits 137 with
 * `UiAutomationService already registered`. Dump is last-resort only when the
 * slot is free and the helper cannot run.
 */
export function androidSnapshotCapturePlan(
  ownership: AndroidSnapshotOwnership,
): AndroidSnapshotBackend[] {
  if (ownership.helperProcessRunning) return [];
  if (ownership.helperAvailable) {
    return ownership.dumpBlocked ? ["helper"] : ["helper", "dump"];
  }
  // A previous 137 does not retire dump forever: the other owner may have exited.
  return ["dump"];
}

/** Dump lost the only UiAutomation slot (helper or another instrumentation). */
export function androidUiAutomatorDumpLooksKilled(notice: string): boolean {
  return /UiAutomationService already registered|already registered!|^\s*Killed\b|\bKilled\s*$|signal 9|exit(?:ed)?(?: code)? 137|\bcode 137\b|SIGKILL/im.test(
    notice,
  );
}

export function androidUiAutomatorDumpLooksEmpty(notice: string): boolean {
  return (
    /null root|ERROR:/i.test(notice) && !/dumped to|hierchary dumped|hierarchy dumped/i.test(notice)
  );
}

type DumpAttempt = { nodes: SnapshotNode[]; blocked: boolean; empty: boolean };

function dumpNotice(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const body = error as {
    stdout?: unknown;
    stderr?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return [
    typeof body.stdout === "string" ? body.stdout : "",
    typeof body.stderr === "string" ? body.stderr : "",
    body.code != null ? `exit ${body.code}` : "",
    typeof body.message === "string" ? body.message : "",
  ].join("\n");
}

function dumpAttemptFromNotice(notice: string): DumpAttempt {
  const blocked = androidUiAutomatorDumpLooksKilled(notice);
  const empty = androidUiAutomatorDumpLooksEmpty(notice);
  return { nodes: [], blocked, empty };
}

async function dumpViaUiAutomatorFile(serial: string): Promise<DumpAttempt> {
  await execAndroidAdb(["-s", serial, "shell", "rm", "-f", ANDROID_DUMP_PATH], {
    timeout: 2_000,
  }).catch(() => undefined);
  const dumped = await execAndroidAdb(
    ["-s", serial, "shell", "uiautomator", "dump", ANDROID_DUMP_PATH],
    { timeout: 6_000, maxBuffer: 64 * 1024, encoding: "utf8" },
  ).catch((error: unknown) => ({ stdout: "", stderr: dumpNotice(error) }));
  const notice = `${dumped.stdout}\n${dumped.stderr}`;
  const classified = dumpAttemptFromNotice(notice);
  if (classified.blocked || classified.empty) return classified;
  try {
    const { stdout } = await execAndroidAdb(["-s", serial, "exec-out", "cat", ANDROID_DUMP_PATH], {
      timeout: 4_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return { nodes: parseAndroidUiSnapshot(stdout), blocked: false, empty: false };
  } catch {
    return { nodes: [], blocked: false, empty: false };
  }
}

async function dumpViaUiAutomatorExecOut(serial: string): Promise<DumpAttempt> {
  try {
    const { stdout, stderr } = await execAndroidAdb(
      ["-s", serial, "exec-out", "uiautomator", "dump", "--compressed", "/dev/tty"],
      { timeout: 4_500, maxBuffer: 4 * 1024 * 1024 },
    );
    const output = `${stdout}\n${stderr}`;
    if (output.includes("<hierarchy")) {
      return { nodes: parseAndroidUiSnapshot(output), blocked: false, empty: false };
    }
    return dumpAttemptFromNotice(output);
  } catch (error) {
    const notice = dumpNotice(error);
    if (notice.includes("<hierarchy")) {
      return { nodes: parseAndroidUiSnapshot(notice), blocked: false, empty: false };
    }
    return dumpAttemptFromNotice(notice);
  }
}

async function dumpViaUiAutomator(serial: string): Promise<DumpAttempt> {
  const fromFile = await dumpViaUiAutomatorFile(serial);
  if (fromFile.blocked || fromFile.empty || fromFile.nodes.length > 0) return fromFile;
  return dumpViaUiAutomatorExecOut(serial);
}

async function androidSnapshotHelperInstalled(serial: string): Promise<boolean> {
  try {
    const { stdout } = await execAndroidAdb(
      ["-s", serial, "shell", "pm", "path", ANDROID_SNAPSHOT_HELPER_PACKAGE],
      { timeout: 2_000, maxBuffer: 16 * 1024 },
    );
    return stdout.includes("package:");
  } catch {
    return false;
  }
}

async function androidSnapshotHelperProcessRunning(serial: string): Promise<boolean> {
  try {
    const { stdout } = await execAndroidAdb(
      ["-s", serial, "shell", "pidof", ANDROID_SNAPSHOT_HELPER_PACKAGE],
      { timeout: 2_000, maxBuffer: 4 * 1024 },
    );
    return /\d/.test(stdout);
  } catch {
    return false;
  }
}

async function androidSnapshotOwnership(serial: string): Promise<AndroidSnapshotOwnership> {
  const [helperProcessRunning, installed, apk] = await Promise.all([
    androidSnapshotHelperProcessRunning(serial),
    androidSnapshotHelperInstalled(serial),
    bundledHelperApkPath(),
  ]);
  return {
    helperProcessRunning,
    helperAvailable: installed || Boolean(apk),
    dumpBlocked: dumpBlockedSerials.has(serial),
  };
}

async function bundledHelperApkPath(): Promise<string | undefined> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "android-helpers");
  try {
    const apk = (await readdir(dir)).find((name) => name.endsWith(".apk"));
    return apk ? join(dir, apk) : undefined;
  } catch {
    return undefined;
  }
}

async function ensureAndroidSnapshotHelperInstalled(serial: string): Promise<boolean> {
  if (await androidSnapshotHelperInstalled(serial)) return true;
  const apk = await bundledHelperApkPath();
  if (!apk) return false;
  try {
    await execAndroidAdb(["-s", serial, "install", "-r", "-t", apk], {
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    });
    return await androidSnapshotHelperInstalled(serial);
  } catch {
    return false;
  }
}

async function dumpViaInstalledHelper(serial: string): Promise<SnapshotNode[]> {
  if (!(await ensureAndroidSnapshotHelperInstalled(serial))) return [];
  const args = [
    "-s",
    serial,
    "shell",
    "am",
    "instrument",
    "-w",
    "-e",
    "waitForIdleTimeoutMs",
    "500",
    "-e",
    "waitForIdleQuietMs",
    "100",
    "-e",
    "timeoutMs",
    "8000",
    "-e",
    "maxDepth",
    "128",
    "-e",
    "maxNodes",
    "5000",
    ANDROID_SNAPSHOT_HELPER_COMPONENT,
  ];
  let output = "";
  try {
    const { stdout, stderr } = await execAndroidAdb(args, {
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    output = `${stdout}\n${stderr}`;
  } catch (error) {
    output = execFileOutput(error);
  }
  const xml = parseAndroidSnapshotHelperInstrumentation(output);
  return xml ? parseAndroidUiSnapshot(xml) : [];
}

/**
 * Read the Android hierarchy without an app-bound SDK session. Keyguard and
 * sleeping displays deliberately return no nodes: Android can expose a stale
 * Always-On Display tree that does not match the pixels being mirrored.
 */
export async function captureAndroidUiSnapshotWithState(
  serial: string,
): Promise<AndroidUiSnapshot> {
  let inspectionState = await captureAndroidInspectionState(serial);
  if (inspectionState === "asleep") {
    await wakeAndroidDisplay(serial).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
    inspectionState = await captureAndroidInspectionState(serial);
  }
  if (inspectionState !== "active") return { nodes: [], inspectionState };
  // One UiAutomation slot. Helper first (sees Niagara windows). Dump only when
  // the slot is still free. Never start a second client if the helper is live.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ownership = await androidSnapshotOwnership(serial);
    const backends = androidSnapshotCapturePlan(ownership);
    if (backends.length === 0) {
      // Live helper session already owns UiAutomation. Leave the slot alone
      // so the SDK path can read the tree.
      return { nodes: [], inspectionState };
    }
    for (const backend of backends) {
      if (backend === "helper") {
        const helped = await dumpViaInstalledHelper(serial);
        if (helped.length > 0) return { nodes: helped, inspectionState };
        if (await androidSnapshotHelperProcessRunning(serial)) {
          dumpBlockedSerials.add(serial);
          return { nodes: [], inspectionState };
        }
        continue;
      }
      if (await androidSnapshotHelperProcessRunning(serial)) {
        dumpBlockedSerials.add(serial);
        return { nodes: [], inspectionState };
      }
      const dumped = await dumpViaUiAutomator(serial);
      if (dumped.blocked) {
        dumpBlockedSerials.add(serial);
        return { nodes: [], inspectionState };
      }
      if (dumped.nodes.length > 0) return { nodes: dumped.nodes, inspectionState };
    }
    if (attempt === 2) return { nodes: [], inspectionState: "unavailable" };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { nodes: [], inspectionState: "unavailable" };
}

/** Compatibility convenience for callers that only need the semantic tree. */
export async function captureAndroidUiSnapshot(serial: string): Promise<SnapshotNode[]> {
  return (await captureAndroidUiSnapshotWithState(serial)).nodes;
}

/** Wake the display and retry label capture. Unlock still needs a person. */
export async function recoverAndroidInspection(serial: string): Promise<{
  serial: string;
  recovered: boolean;
  ready: boolean;
  summary: string;
  actions: Array<{
    kind: "stale-lock" | "agent-device" | "core-device";
    status: "completed" | "skipped" | "failed";
    detail: string;
  }>;
  session: {
    status: "restored" | "unavailable";
    app?: string;
    fallback?: boolean;
    detail: string;
  };
}> {
  const before = await captureAndroidInspectionState(serial);
  if (before === "asleep" || before === "keyguard" || before === "unknown") {
    await wakeAndroidDisplay(serial).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const snapshot = await captureAndroidUiSnapshotWithState(serial);
  const app = androidSnapshotApplication(snapshot.nodes);
  const ready = snapshot.inspectionState === "active" && snapshot.nodes.length > 0;
  const detail = ready
    ? "Relay can read names on this screen."
    : snapshot.inspectionState === "keyguard"
      ? "Unlock the phone, then press Reconnect."
      : snapshot.inspectionState === "asleep"
        ? "The screen is still off. Press power, then Reconnect."
        : "Relay still cannot read names. Tapping the picture still works.";
  return {
    serial,
    recovered: before !== snapshot.inspectionState || ready,
    ready,
    summary: detail,
    actions: [
      {
        kind: "agent-device",
        status: ready
          ? "completed"
          : snapshot.inspectionState === "keyguard"
            ? "skipped"
            : "failed",
        detail:
          before === "asleep"
            ? "Woke the screen and refreshed labels."
            : "Retried reading names on this screen.",
      },
    ],
    session: {
      status: ready ? "restored" : "unavailable",
      ...(app ? { app } : {}),
      fallback: !ready,
      detail,
    },
  };
}
