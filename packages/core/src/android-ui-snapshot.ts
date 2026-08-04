import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SnapshotNode } from "./device.js";

const execFileAsync = promisify(execFile);

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

export async function captureAndroidInspectionState(
  serial: string,
): Promise<AndroidInspectionState> {
  try {
    const { stdout } = await execFileAsync(
      "adb",
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
    const { stdout } = await execFileAsync(
      "adb",
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
    const label = attrs["content-desc"]?.trim();
    const clickable = bool(attrs.clickable) === true;
    const focusable = bool(attrs.focusable) === true;
    const longClickable = bool(attrs["long-clickable"]) === true;
    const scrollable = bool(attrs.scrollable) === true;
    const index = nodes.length;
    nodes.push({
      ...(label || text ? { label: label || text } : {}),
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

/**
 * Read the Android hierarchy without an app-bound SDK session. Keyguard and
 * sleeping displays deliberately return no nodes: Android can expose a stale
 * Always-On Display tree that does not match the pixels being mirrored.
 */
export async function captureAndroidUiSnapshotWithState(
  serial: string,
): Promise<AndroidUiSnapshot> {
  const inspectionState = await captureAndroidInspectionState(serial);
  if (inspectionState !== "active") return { nodes: [], inspectionState };
  // Android can briefly report a null accessibility root while an activity is
  // changing. Retrying here keeps that transport quirk out of the recorder and
  // lets future snapshot sources be swapped without changing callers.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "adb",
        ["-s", serial, "exec-out", "uiautomator", "dump", "--compressed", "/dev/tty"],
        { timeout: 4_500, maxBuffer: 4 * 1024 * 1024 },
      );
      const nodes = parseAndroidUiSnapshot(stdout);
      if (nodes.length > 0) return { nodes, inspectionState };
      if (attempt === 2) return { nodes: [], inspectionState: "unavailable" };
    } catch {
      // A null root is common during activity and keyguard transitions. Give
      // Android a short chance to settle, then return an empty tree so callers
      // clear their overlay rather than retaining a stale one.
      if (attempt === 2) return { nodes: [], inspectionState: "unavailable" };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { nodes: [], inspectionState: "unavailable" };
}

/** Compatibility convenience for callers that only need the semantic tree. */
export async function captureAndroidUiSnapshot(serial: string): Promise<SnapshotNode[]> {
  return (await captureAndroidUiSnapshotWithState(serial)).nodes;
}
