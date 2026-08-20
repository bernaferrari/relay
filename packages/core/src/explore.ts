/**
 * Shared explore primitives — sheet-aware back, safe list scroll, chrome filters,
 * and a one-shot "where am I" summary.
 *
 * Used by tree crawls (API id corpus), discovery, locale-run, and agents.
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
} from "./device.js";
import {
  hasProfileChromePrefix,
  profileBackAffordances,
  profileCloseAffordances,
} from "./discovery-app-profiles.js";
import { observeLocaleStableIdentity } from "./screen-identity.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { captureSnapshot, formatSnapshotTree, interact } from "./workspace.js";
import { devicePlatformForSerial } from "./workspace.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";

/** Destructive / external rows agents and crawls should skip by default. */
export function isUnsafeExploreControlText(value: string): boolean {
  return /(delete|remove|purchase|pay|subscribe|logout|sign out|password|permission|\bupdate\b|rate the app|terms of use|privacy policy|help & support|help and support|open in safari|open in browser|open in internet|\bsafari\b)/i.test(
    value,
  );
}

/**
 * Discovery maps should learn navigation before they exercise app state. A
 * stateful control can be perfectly safe for an intentional recording, but a
 * background explorer cannot know the user wants to change a setting. Keep
 * those controls out of its automatic queue while leaving them available to
 * the explicit recorder.
 */
export function isExploreStateChangingNode(node: SnapshotNode): boolean {
  return /switch|toggle|checkbox|radio(?:button)?|slider|seekbar|stepper|edit(?:able)?text|text(?:field|box)|input/i.test(
    `${node.role ?? ""} ${node.type ?? ""}`,
  );
}

export type ExploreChromeOptions = {
  /** When true, also treat app-language switcher rows as chrome (out-of-band only). */
  excludeLanguageSwitcher?: boolean;
};

/** Sheet chrome, search fields, and other non-content affordances. */
export function isExploreChromeLabel(value: string, options?: ExploreChromeOptions): boolean {
  const label = value.trim().toLocaleLowerCase();
  if (!label) return true;
  if (
    /^(close|done|cancel|back|dismiss|dismiss popup|home|recents|recent apps|overview|navigate up|voice search|what are you looking for\??|more options|ask anything|launch gallery selector|open microsoft swiftkey toolbar|start dictation|voice typing|symbols and numbers|double tap for caps lock|search|search settings)$/i.test(
      label,
    )
  ) {
    return true;
  }
  if (/^capital [a-z]$/i.test(label)) return true;
  // Toolbar / brand affordances that leak into a11y trees. Which words an app
  // stamps on its own chrome is profile data, not a platform fact.
  if (hasProfileChromePrefix(label)) return true;
  if (/^toolbar\./i.test(label)) return true;
  // Scrollbars and page indicators are not navigation.
  if (/scroll bar|scrollbar|vertical scroll|horizontal scroll|page indicator/i.test(label)) {
    return true;
  }
  // Pure switch values often appear as sibling "0"/"1" controls.
  if (/^[01]$/.test(label)) return true;
  if (/^localizedstringkey\(key: "(close|done|cancel|back)"/i.test(label)) return true;
  if (
    options?.excludeLanguageSwitcher !== false &&
    /app language|idioma do app|langue de l.application|app-sprache|idioma de la app/i.test(label)
  ) {
    return true;
  }
  // Section headers often appear as all-caps cells (APP, GROK, VOICE).
  if (/^[A-Z0-9][A-Z0-9 &/.-]{0,22}$/.test(value.trim()) && value === value.toUpperCase()) {
    return true;
  }
  return false;
}

const EXPLORE_SYSTEM_OWNER =
  /(?:^|\s)(?:com\.android\.systemui|com\.touchtype\.swiftkey|com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard)(?::|\/|\.|\s|$)/i;
const EXPLORE_CHROME_IDENTIFIER =
  /(?:search_voice|search_bar|collapsing_appbar|floating_toolbar|sesl_floating_toolbar)/i;

/** System chrome, IME, and non-content affordances a crawler must not tap. */
export function isExploreChromeNode(node: SnapshotNode, options?: ExploreChromeOptions): boolean {
  const owner = `${node.bundleId ?? ""} ${node.identifier ?? ""}`;
  if (EXPLORE_SYSTEM_OWNER.test(owner)) return true;
  if (EXPLORE_CHROME_IDENTIFIER.test(node.identifier ?? "")) return true;
  const spoken = (node.label ?? node.value ?? "").trim();
  if (!spoken) return false;
  return isExploreChromeLabel(spoken, options);
}

export type ExploreControl = {
  label: string;
  stableKey?: string;
  role?: string;
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
  };
};

/**
 * Interactive candidates from one snapshot. Prefer identifiers / refs.
 * Callers that need domain-stable keys (i18n packs) should map further.
 */
export function exploreControls(
  nodes: SnapshotNode[],
  options?: {
    allowSensitive?: boolean;
    chrome?: ExploreChromeOptions;
    limit?: number;
  },
): ExploreControl[] {
  const seen = new Set<string>();
  const limit = Math.max(1, Math.min(120, options?.limit ?? 60));
  return nodes
    .filter(
      (node) =>
        node.visibleToUser !== false &&
        node.enabled !== false &&
        (node.hittable || node.identifier || node.ref || node.type === "Cell"),
    )
    .flatMap((node) => {
      const label = (node.label ?? node.value ?? node.identifier ?? "").trim();
      if (!label) return [];
      if (isExploreChromeNode(node, options?.chrome)) return [];
      if (!options?.allowSensitive && isUnsafeExploreControlText(label)) return [];
      const target = node.identifier
        ? { identifier: node.identifier }
        : node.ref
          ? { ref: node.ref }
          : node.label
            ? { label: node.label }
            : undefined;
      if (!target) return [];
      const key = JSON.stringify(target);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          label,
          role: node.role ?? node.type,
          target,
        },
      ];
    })
    .slice(0, limit);
}

async function tryPressLabel(device: Device, label: string): Promise<boolean> {
  if (!(await exists(device, label))) return false;
  try {
    await pressLabel(device, label);
    await sleep(450, device);
    return true;
  } catch (error) {
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
        rethrowIosMutationOutcomeUnknown(error);
        /* ignore */
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
