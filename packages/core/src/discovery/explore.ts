/**
 * Shared explore primitives — sheet-aware back, safe list scroll, chrome filters,
 * and a one-shot "where am I" summary.
 *
 * Used by exploration, App Map discovery, and agents.
 * Not a product mode: just the verbs every navigation job needs.
 */
import {
  createDevice,
  exists,
  findClick,
  pressKey,
  pressLabel,
  scrollDown,
  scrollUp,
  sleep,
  snapshot,
  type Device,
  type SnapshotNode,
} from "../device/device.js";
import { profileBackAffordances, profileCloseAffordances } from "./discovery-app-profiles.js";
import { rethrowIosMutationOutcomeUnknown } from "../ios/ios-mutation-policy.js";
import { observeLocaleStableIdentity } from "../screen/screen-identity.js";
import { currentTargetContext, runWithTargetContext } from "../target/target-context.js";
import { captureSnapshot, formatSnapshotTree, interact } from "../workspace/workspace.js";
import { devicePlatformForSerial } from "../workspace/workspace.js";

export {
  exploreControls,
  isExploreChromeLabel,
  isExploreChromeNode,
  isExploreStateChangingNode,
  isUnsafeExploreControlText,
  type ExploreChromeOptions,
  type ExploreControl,
} from "./explore-controls.js";

async function tryPressLabel(device: Device, label: string): Promise<boolean> {
  if (!(await exists(device, label))) return false;
  try {
    await pressLabel(device, label);
    await sleep(450, device);
    return true;
  } catch (error) {
    // A label press that may already have reached iOS is not a locator miss.
    // In particular, do not let findClick turn one uncertain physical press
    // into a second one just because it uses a different selector shape.
    rethrowIosMutationOutcomeUnknown(error);
    try {
      await findClick(device, label);
      await sleep(450, device);
      return true;
    } catch (fallbackError) {
      rethrowIosMutationOutcomeUnknown(fallbackError);
      return false;
    }
  }
}

export type DismissTowardParentOptions = {
  serial: string;
  device?: Device;
  /** Parent nav titles to try after Back (e.g. Settings). */
  parentTitles?: string[];
  /** Test/caller override; otherwise resolved from the connected target. */
  platform?: "ios" | "android";
};

async function runOnConnectedDevice<T>(
  serial: string,
  operation: () => Promise<T>,
  explicit?: "ios" | "android",
): Promise<T> {
  const platform = explicit ?? (await devicePlatformForSerial(serial));
  if (platform !== "android" && platform !== "ios") {
    throw new Error(`Target ${serial} is not a connected android or ios device`);
  }
  return runWithTargetContext({ kind: "device", platform, serial }, operation);
}

/**
 * Pop one level of UI. Prefer real nav back over sheet dismiss.
 * iOS modal sheets often keep Close visible on every nested page — tapping it
 * first would leave the whole tree.
 */
export async function dismissTowardParent(
  options: DismissTowardParentOptions,
): Promise<"back" | "parent" | "close" | "key" | "edge-swipe"> {
  return runOnConnectedDevice(
    options.serial,
    () => dismissTowardParentInContext(options),
    options.platform,
  );
}

async function dismissTowardParentInContext(
  options: DismissTowardParentOptions,
): Promise<"back" | "parent" | "close" | "key" | "edge-swipe"> {
  const device = options.device ?? createDevice();
  const parents = options.parentTitles ?? [];

  // A profile's own back chevron before the generic "Back".
  for (const label of [...profileBackAffordances(), "Back", "back"]) {
    if (await tryPressLabel(device, label)) return "back";
  }

  for (const title of parents) {
    if (await tryPressLabel(device, title)) return "parent";
  }

  for (const label of ["Close", "Done", "Cancel", ...profileCloseAffordances()]) {
    if (await tryPressLabel(device, label)) return "close";
  }

  try {
    await pressKey(device, "back");
    await sleep(500, device);
    return "key";
  } catch (error) {
    // An uncertain native Back might already have left the screen. An edge
    // swipe would be a second, unrelated navigation mutation, so surface the
    // typed repair stop instead of attempting it.
    rethrowIosMutationOutcomeUnknown(error);
    await interact(
      {
        kind: "swipe",
        from: { x: 0.02, y: 0.5 },
        to: { x: 0.55, y: 0.5 },
        durationMs: 280,
      },
      { serial: options.serial },
    );
    await sleep(500, device);
    return "edge-swipe";
  }
}

export type ScrollCollectOptions<T extends { stableKey?: string; label: string }> = {
  serial: string;
  device?: Device;
  extract: (nodes: SnapshotNode[]) => T[];
  maxScrolls?: number;
  /** Key used to dedupe across scroll pages. */
  keyOf?: (control: T) => string;
  /** Test/caller override; otherwise resolved from the connected target. */
  platform?: "ios" | "android";
};

/**
 * Android exposes the visible bounds of a Compose ScrollView even when the
 * `scrollable` flag is missing. A generous empty tail means the last row is
 * already on screen, so probing further only creates noise and latency.
 */
export function scrollContentFitsViewport(nodes: SnapshotNode[]): boolean {
  const indexed = new Map(nodes.map((node, fallback) => [node.index ?? fallback, node] as const));
  const scrollViews = nodes.filter((node) =>
    /scrollview|scrollarea|collectionview/i.test(`${node.type ?? ""} ${node.role ?? ""}`),
  );
  return scrollViews.some((scrollView) => {
    const viewport = scrollView.rect;
    const scrollIndex = scrollView.index;
    if (!viewport || scrollIndex === undefined || viewport.height < 240) return false;
    const descendantBottoms = nodes.flatMap((node) => {
      if (!node.rect || node.visibleToUser === false || node.index === scrollIndex) return [];
      let parentIndex = node.parentIndex;
      let guard = 0;
      while (parentIndex !== undefined && guard < 20) {
        if (parentIndex === scrollIndex) return [node.rect.y + node.rect.height];
        parentIndex = indexed.get(parentIndex)?.parentIndex;
        guard += 1;
      }
      return [];
    });
    if (!descendantBottoms.length) return false;
    const lastBottom = Math.max(...descendantBottoms);
    const viewportBottom = viewport.y + viewport.height;
    const emptyTail = Math.max(96, viewport.height * 0.12);
    return lastBottom <= viewportBottom - emptyTail;
  });
}

/**
 * Scroll a long list and merge extracted controls. Stops if locale-stable
 * screen identity changes (overscroll dismissed a sheet).
 */
export async function scrollCollectControls<T extends { stableKey?: string; label: string }>(
  options: ScrollCollectOptions<T>,
): Promise<{ nodes: SnapshotNode[]; controls: T[] }> {
  return runOnConnectedDevice(
    options.serial,
    () => scrollCollectControlsInContext(options),
    options.platform,
  );
}

async function readExploreNodes(serial: string, device?: Device): Promise<SnapshotNode[]> {
  if (device) return snapshot(device);
  return (await captureSnapshot({ serial })).nodes;
}

async function scrollCollectControlsInContext<T extends { stableKey?: string; label: string }>(
  options: ScrollCollectOptions<T>,
): Promise<{ nodes: SnapshotNode[]; controls: T[] }> {
  const device = options.device ?? createDevice();
  const maxScrolls = Math.max(0, Math.min(8, options.maxScrolls ?? 4));
  const keyOf =
    options.keyOf ?? ((control: T) => control.stableKey ?? control.label.toLocaleLowerCase());

  const firstNodes = await readExploreNodes(options.serial, options.device);
  const rootKey = observeLocaleStableIdentity(firstNodes).fingerprint;
  const byKey = new Map<string, T>();
  const merge = (nodes: SnapshotNode[]) => {
    for (const control of options.extract(nodes)) {
      const key = keyOf(control);
      if (!byKey.has(key)) byKey.set(key, control);
    }
  };
  merge(firstNodes);
  let latest = firstNodes;
  let stableEmpty = 0;
  let completedScrolls = 0;
  const contentAlreadyFits =
    (options.platform ?? currentTargetContext().platform) === "android" &&
    scrollContentFitsViewport(firstNodes);

  for (let i = 0; i < (contentAlreadyFits ? 0 : maxScrolls); i += 1) {
    const before = byKey.size;
    try {
      await scrollDown(device, 0.55);
      completedScrolls += 1;
    } catch (error) {
      // A failed iOS scroll can be an unknown completed scroll. Do not turn
      // that ambiguity into later collection or inverse restoration gestures.
      rethrowIosMutationOutcomeUnknown(error);
      break;
    }
    await sleep(350, device);
    const snapNodes = await readExploreNodes(options.serial, options.device);
    latest = snapNodes;
    const key = observeLocaleStableIdentity(snapNodes).fingerprint;
    if (key !== rootKey) {
      try {
        await interact(
          {
            kind: "swipe",
            from: { x: 0.5, y: 0.35 },
            to: { x: 0.5, y: 0.7 },
            durationMs: 280,
          },
          { serial: options.serial },
        );
        await sleep(300, device);
      } catch (error) {
        // The corrective swipe is a physical mutation too. If its delivery is
        // uncertain, stop with the one-command diagnostic rather than quietly
        // continuing from an unknown viewport.
        rethrowIosMutationOutcomeUnknown(error);
      }
      break;
    }
    merge(snapNodes);
    if (byKey.size === before) {
      stableEmpty += 1;
      if (stableEmpty >= 2) break;
    } else {
      stableEmpty = 0;
    }
  }

  // Collection is observational: restore the exact number of successful
  // scrolls so callers continue from the viewport they started on.
  for (let i = 0; i < completedScrolls; i += 1) {
    try {
      await scrollUp(device, 0.55);
      await sleep(250, device);
    } catch (error) {
      // Do not suppress an uncertain restore command. The caller needs to
      // review current pixels before issuing any more navigation.
      rethrowIosMutationOutcomeUnknown(error);
      break;
    }
  }

  try {
    latest = await readExploreNodes(options.serial, options.device);
    merge(latest);
  } catch {
    /* keep last */
  }

  return { nodes: latest, controls: [...byKey.values()] };
}

export type TargetUiDescription = {
  platform?: string;
  serial?: string;
  foregroundApp?: string;
  titles: string[];
  sheetLikely: boolean;
  keyboardLikely: boolean;
  topLabels: string[];
  /** Snapshot rects / press targets use logical points, not screenshot pixels. */
  coordinateSpace: "logical-points";
  bounds?: { width: number; height: number };
  nodeCount: number;
  summary: string;
  treePreview: string;
};

function looksLikeKeyboard(nodes: SnapshotNode[]): boolean {
  return nodes.some((node) => {
    const type = (node.type ?? node.role ?? "").toLocaleLowerCase();
    const label = (node.label ?? "").toLocaleLowerCase();
    return (
      type === "keyboard" ||
      type === "key" ||
      label === "hide keyboard" ||
      label === "space" ||
      label === "return" ||
      label === "retorno"
    );
  });
}

function looksLikeSheet(nodes: SnapshotNode[]): boolean {
  const labels = new Set(
    nodes.map((node) => (node.label ?? "").trim().toLocaleLowerCase()).filter(Boolean),
  );
  if (labels.has("close") || labels.has("done")) return true;
  if (profileCloseAffordances().some((label) => labels.has(label.toLocaleLowerCase()))) return true;
  if (labels.has("dismiss popup")) return true;
  return nodes.some((node) => {
    const type = (node.type ?? "").toLocaleLowerCase();
    return type === "sheet" || type === "dialog" || type === "alert";
  });
}

/** One-shot orientation for agents: app, sheet/keyboard, titles, logical bounds. */
export async function describeTargetUi(serial: string): Promise<TargetUiDescription> {
  return runOnConnectedDevice(serial, async () => {
    const platform =
      currentTargetContext().kind === "device" ? currentTargetContext().platform : undefined;
    const snap = await captureSnapshot({ serial });
    const nodes = snap.nodes;
    const root = nodes.find((node) => node.depth === 0 && node.rect);
    const titles = nodes
      .filter((node) => {
        const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
        return /header|heading|navigationbar|statictext/.test(role);
      })
      .map((node) => (node.label ?? "").trim())
      .filter((label) => label && label.length < 80)
      .slice(0, 8);
    const topLabels = nodes
      .map((node) => (node.label ?? "").trim())
      .filter(Boolean)
      .slice(0, 16);
    const sheetLikely = looksLikeSheet(nodes);
    const keyboardLikely = looksLikeKeyboard(nodes);
    const bounds = root?.rect
      ? { width: Math.round(root.rect.width), height: Math.round(root.rect.height) }
      : undefined;
    const foregroundApp =
      (snap as { foregroundApp?: string }).foregroundApp ?? root?.bundleId ?? root?.label;
    const parts = [
      foregroundApp ? `app=${foregroundApp}` : null,
      bounds ? `bounds=${bounds.width}x${bounds.height} logical-pt` : null,
      sheetLikely ? "sheet" : null,
      keyboardLikely ? "keyboard" : null,
      titles[0] ? `title=${titles[0]}` : null,
      `nodes=${nodes.length}`,
    ].filter(Boolean);
    return {
      ...(platform ? { platform } : {}),
      serial,
      ...(foregroundApp ? { foregroundApp } : {}),
      titles,
      sheetLikely,
      keyboardLikely,
      topLabels,
      coordinateSpace: "logical-points" as const,
      ...(bounds ? { bounds } : {}),
      nodeCount: nodes.length,
      summary: parts.join(" · "),
      treePreview: formatSnapshotTree(nodes, 40),
    };
  });
}

/** Convenience when already inside target context. */
export async function describeCurrentTargetUi(): Promise<TargetUiDescription> {
  const context = currentTargetContext();
  if (context.kind !== "device") {
    throw new Error("describeCurrentTargetUi requires a device target context");
  }
  return describeTargetUi(context.serial);
}
