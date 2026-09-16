/**
 * Talk to a LISTENER_READY testCommand runner over usbmux without taking
 * the lease or spawning xcodebuild. Relay’s agent-device session is
 * `relay-ios-<serial>` and does not own the daemon’s live runner; recipes
 * still need named controls. A healthy listener is not a recover-kill.
 */
import { createConnection, type Socket } from "node:net";
import type { SnapshotNode } from "./device-capabilities.js";
import { resolveNamedControl } from "./device-target-resolution.js";
import { probeLiveIosRunnerListener, type LiveIosRunnerListener } from "./ios-runner-listener.js";

const USBMUXD_SOCKET_PATH = "/var/run/usbmuxd";
const USBMUX_HEADER_BYTES = 16;
const USBMUX_PROTOCOL_VERSION = 1;
const USBMUX_MESSAGE_PLIST = 8;

export type LiveIosRunnerCommand = Record<string, unknown>;

export type LiveIosRunnerCommandResult = {
  ok?: boolean;
  error?: string | { message?: string; code?: string };
  data?: { nodes?: SnapshotNode[]; message?: string; found?: boolean };
  nodes?: SnapshotNode[];
};

export type LiveIosRunnerCommandPost = (
  listener: LiveIosRunnerListener,
  command: LiveIosRunnerCommand,
  timeoutMs: number,
) => Promise<LiveIosRunnerCommandResult>;

let injectedPost: LiveIosRunnerCommandPost | undefined;

/** Test-only seam. Production always posts over usbmuxd. */
export function setLiveIosRunnerCommandPostForTests(post?: LiveIosRunnerCommandPost): () => void {
  const previous = injectedPost;
  injectedPost = post;
  return () => {
    injectedPost = previous;
  };
}

export function isIosSessionMissingSnapshotError(error: unknown): boolean {
  return /session|open first/i.test(unknownErrorMessage(error));
}

/** Runner failures arrive as `{message, code}` objects. `String(error)` is `[object Object]`. */
export function unknownErrorMessage(error: unknown, fallback = "unknown error"): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.code === "string" && record.code.trim()) return record.code;
  }
  return fallback;
}

function liveIosRunnerFailureMessage(result: LiveIosRunnerCommandResult, fallback: string): string {
  return unknownErrorMessage(result.error, unknownErrorMessage(result.data?.message, fallback));
}

const IOS_RUNNER_HOST_PROBE_IDS = new Set([
  "agent-device.clipboard.probe",
  "agent-device.clipboard.copy",
]);

/** The live listener answered, but XCTest is still parked on AgentDeviceRunner. */
export function isIosRunnerHostProbeTree(nodes: readonly SnapshotNode[]): boolean {
  return nodes.some((node) => {
    const identifier = node.identifier?.trim() ?? "";
    const label = node.label?.trim() ?? "";
    if (IOS_RUNNER_HOST_PROBE_IDS.has(identifier)) return true;
    return label === "Copy probe" || label === "AgentDeviceRunner";
  });
}

/** Unique home chrome — never walk Grok conversation lists. */
export const IOS_BOUNDED_HOME_CHROME_IDENTIFIERS = [
  "ask.toolbar.textfield",
  "sidebar.open.button",
  "toolbar.model.selector.button",
  "voice.speak.button",
  "ask.toolbar.add.button",
] as const;

/** Unique attach-sheet ids. Query only when `+` is present — XCTest id-miss on an open library walks the list. */
export const IOS_BOUNDED_ATTACH_MENU_IDENTIFIERS = [
  "ask.toolbar.add.menu.camera",
  "ask.toolbar.add.menu.photos",
  "ask.toolbar.add.menu.files",
  "ask.toolbar.add.menu.connectors",
  "ask.toolbar.add.menu.skills",
] as const;

/** Unique sidebar chrome omitted from home n=7. */
export const IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS = [
  "sidebar.settings.button",
  "sidebar.search.field",
] as const;

/** Home chrome + unique attach-sheet / sidebar ids — never walk Grok conversation lists. */
export const IOS_BOUNDED_CHROME_IDENTIFIERS = [
  ...IOS_BOUNDED_HOME_CHROME_IDENTIFIERS,
  ...IOS_BOUNDED_ATTACH_MENU_IDENTIFIERS,
  ...IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS,
] as const;

/** Unique SuperGrok chrome labels omitted from chrome-bounded snapshot. */
export const IOS_BOUNDED_CHROME_LABELS = [
  "grok-compose",
  "grok-arrows-right",
  "grok-gear",
  "grok-3-dots",
] as const;

const IOS_APPLICATION_ROOT_DEPTH = 0;
const IOS_BOUNDED_SNAPSHOT_DEPTH = 4;
const IOS_DISAMBIGUATION_SNAPSHOT_DEPTH = 16;
const IOS_CHROME_QUERY_TIMEOUT_MS = 8_000;

function iosRunnerCommandIsAmbiguous(result: LiveIosRunnerCommandResult): boolean {
  const code = result.error && typeof result.error === "object" ? result.error.code : undefined;
  if (code === "AMBIGUOUS_MATCH") return true;
  return /AMBIGUOUS_MATCH|selector matched multiple/i.test(unknownErrorMessage(result.error, ""));
}

/** Abandoned AX work: refuse fast. Do not fall through to another XCTest command. */
export function liveIosRunnerCommandIsBusy(result: LiveIosRunnerCommandResult): boolean {
  const code = result.error && typeof result.error === "object" ? result.error.code : undefined;
  if (code === "RUNNER_BUSY" || code === "RUNNER_WEDGED") return true;
  return /RUNNER_BUSY|RUNNER_WEDGED|still finishing a previous command|execution watchdog|main thread has been stuck/i.test(
    unknownErrorMessage(result.error, ""),
  );
}

/** Depth-0 Application only — logical viewport for preview scale, not a list walk. */
async function snapshotIosApplicationRootViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: { appBundleId?: string },
  timeoutMs: number,
): Promise<SnapshotNode | undefined> {
  const result = await post(
    listener,
    {
      command: "snapshot",
      interactiveOnly: false,
      depth: IOS_APPLICATION_ROOT_DEPTH,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    timeoutMs,
  );
  if (result.ok === false) return undefined;
  const nodes = result.data?.nodes ?? result.nodes ?? [];
  if (isIosRunnerHostProbeTree(nodes)) return undefined;
  return nodes.find(
    (node) =>
      node.depth === 0 &&
      node.type === "Application" &&
      node.rect !== undefined &&
      node.rect.width >= 100 &&
      node.rect.height >= 100,
  );
}

/** Full tree for same-id ranking. Chrome-bounded snapshot omits Settings close. */
async function snapshotIosDisambiguationTreeViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: { appBundleId?: string; timeoutMs?: number },
): Promise<SnapshotNode[]> {
  const result = await post(
    listener,
    {
      command: "snapshot",
      interactiveOnly: false,
      depth: IOS_DISAMBIGUATION_SNAPSHOT_DEPTH,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    input.timeoutMs ?? 20_000,
  );
  if (result.ok === false) {
    throw new Error(liveIosRunnerFailureMessage(result, "Live XCTest listener snapshot failed"));
  }
  const nodes = result.data?.nodes ?? result.nodes ?? [];
  if (isIosRunnerHostProbeTree(nodes)) {
    throw new Error(
      "Live XCTest listener snapshot is AgentDeviceRunner Copy probe, not the product app",
    );
  }
  return nodes;
}

async function snapshotRequestedIosChromeViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    includeIdentifiers?: readonly string[];
    includeLabels?: readonly string[];
  },
  timeoutMs: number,
): Promise<SnapshotNode[]> {
  const identifiers = await queryIosChromeSelectorsViaListener(
    listener,
    post,
    {
      selectorKey: "id",
      values: chromeValuesToQuery([], input.includeIdentifiers),
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    timeoutMs,
  );
  const labels = await queryIosChromeSelectorsViaListener(
    listener,
    post,
    {
      selectorKey: "label",
      values: chromeValuesToQuery([], input.includeLabels),
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    timeoutMs,
  );
  const chrome = [...identifiers, ...labels];
  if (isIosRunnerHostProbeTree(chrome)) {
    throw new Error(
      "Live XCTest listener snapshot is AgentDeviceRunner Copy probe, not the product app",
    );
  }
  const application = await snapshotIosApplicationRootViaListener(listener, post, input, timeoutMs);
  return application ? [application, ...chrome] : chrome;
}

export async function snapshotViaLiveIosRunnerListener(input: {
  serial: string;
  interactiveOnly?: boolean;
  appBundleId?: string;
  timeoutMs?: number;
  includeIdentifiers?: readonly string[];
  includeLabels?: readonly string[];
  /** Query only includeIdentifiers/includeLabels — never the home/library catalog. */
  requestedChromeOnly?: boolean;
}): Promise<SnapshotNode[]> {
  const listener = await probeLiveIosRunnerListener(input.serial);
  if (!listener) {
    throw new Error("iOS snapshot needs an active XCTest session");
  }
  const post = injectedPost ?? postLiveIosRunnerCommand;
  const timeoutMs = input.timeoutMs ?? 20_000;
  if (input.requestedChromeOnly) {
    return snapshotRequestedIosChromeViaListener(listener, post, input, timeoutMs);
  }
  const identifiers = await queryIosChromeIdentifiersViaListener(listener, post, input, timeoutMs);
  const hamburgerPresent = chromeNodeHasIdentifier(identifiers, "sidebar.open.button");
  const chrome = [
    ...identifiers,
    ...(await queryIosChromeLabelsViaListener(listener, post, input, timeoutMs, {
      includeDefaults: !hamburgerPresent,
    })),
  ];
  if (chrome.length > 0) {
    if (isIosRunnerHostProbeTree(chrome)) {
      throw new Error(
        "Live XCTest listener snapshot is AgentDeviceRunner Copy probe, not the product app",
      );
    }
    const application = await snapshotIosApplicationRootViaListener(
      listener,
      post,
      input,
      timeoutMs,
    );
    return application ? [application, ...chrome] : chrome;
  }
  const command: LiveIosRunnerCommand = {
    command: "snapshot",
    interactiveOnly: input.interactiveOnly ?? true,
    depth: IOS_BOUNDED_SNAPSHOT_DEPTH,
    ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
  };
  const result = await post(listener, command, timeoutMs);
  if (result.ok === false) {
    throw new Error(liveIosRunnerFailureMessage(result, "Live XCTest listener snapshot failed"));
  }
  const nodes = result.data?.nodes ?? result.nodes ?? [];
  if (isIosRunnerHostProbeTree(nodes)) {
    throw new Error(
      "Live XCTest listener snapshot is AgentDeviceRunner Copy probe, not the product app",
    );
  }
  return nodes;
}

function chromeValuesToQuery(known: readonly string[], extra?: readonly string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of [...known, ...(extra ?? [])]) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

async function queryIosChromeSelectorsViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    selectorKey: "id" | "label";
    values: readonly string[];
  },
  timeoutMs: number,
): Promise<SnapshotNode[]> {
  if (input.values.length === 0) return [];
  const nodes: SnapshotNode[] = [];
  const queryTimeout = Math.min(timeoutMs, IOS_CHROME_QUERY_TIMEOUT_MS);
  for (const value of input.values) {
    const result = await post(
      listener,
      {
        command: "querySelector",
        selectorKey: input.selectorKey,
        selectorValue: value,
        ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
      },
      queryTimeout,
    );
    if (result.ok === false) continue;
    const found = result.data?.nodes ?? result.nodes ?? [];
    for (const node of found) {
      nodes.push({
        ...node,
        ...(input.selectorKey === "id"
          ? { identifier: node.identifier?.trim() || value }
          : { label: node.label?.trim() || value }),
        logicalCoordinates: true,
      });
    }
  }
  return nodes;
}

const IOS_ATTACH_MENU_IDENTIFIER_SET = new Set<string>(IOS_BOUNDED_ATTACH_MENU_IDENTIFIERS);
const IOS_SIDEBAR_CHROME_IDENTIFIER_SET = new Set<string>(IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS);

function chromeNodeHasIdentifier(nodes: readonly SnapshotNode[], identifier: string): boolean {
  return nodes.some((node) => (node.identifier?.trim() || "") === identifier);
}

function isDeferredChromeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return (
    IOS_ATTACH_MENU_IDENTIFIER_SET.has(trimmed) || IOS_SIDEBAR_CHROME_IDENTIFIER_SET.has(trimmed)
  );
}

async function queryIosChromeIdentifiersViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: { appBundleId?: string; includeIdentifiers?: readonly string[] },
  timeoutMs: number,
): Promise<SnapshotNode[]> {
  const extra = input.includeIdentifiers ?? [];
  const requestedAttach = extra.filter((value) => IOS_ATTACH_MENU_IDENTIFIER_SET.has(value.trim()));
  const requestedSidebar = extra.filter((value) =>
    IOS_SIDEBAR_CHROME_IDENTIFIER_SET.has(value.trim()),
  );
  const home = await queryIosChromeSelectorsViaListener(
    listener,
    post,
    {
      selectorKey: "id",
      values: chromeValuesToQuery(
        IOS_BOUNDED_HOME_CHROME_IDENTIFIERS,
        extra.filter((value) => !isDeferredChromeIdentifier(value)),
      ),
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    timeoutMs,
  );
  const hamburgerPresent = chromeNodeHasIdentifier(home, "sidebar.open.button");
  const sidebarValues = hamburgerPresent
    ? chromeValuesToQuery([], requestedSidebar)
    : chromeValuesToQuery(IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS, requestedSidebar);
  const sidebar =
    sidebarValues.length === 0
      ? []
      : await queryIosChromeSelectorsViaListener(
          listener,
          post,
          {
            selectorKey: "id",
            values: sidebarValues,
            ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
          },
          timeoutMs,
        );
  const attach =
    requestedAttach.length === 0
      ? []
      : await queryIosChromeSelectorsViaListener(
          listener,
          post,
          {
            selectorKey: "id",
            values: chromeValuesToQuery([], requestedAttach),
            ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
          },
          timeoutMs,
        );
  return [...home, ...sidebar, ...attach];
}

async function queryIosChromeLabelsViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: { appBundleId?: string; includeLabels?: readonly string[] },
  timeoutMs: number,
  options?: { includeDefaults?: boolean },
): Promise<SnapshotNode[]> {
  const defaults = options?.includeDefaults === false ? [] : IOS_BOUNDED_CHROME_LABELS;
  const values = chromeValuesToQuery(defaults, input.includeLabels);
  if (values.length === 0) return [];
  return queryIosChromeSelectorsViaListener(
    listener,
    post,
    {
      selectorKey: "label",
      values,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    timeoutMs,
  );
}

/** `true`/`false` when the adopted listener answered. `undefined` if no listener. */
export async function identifierPresentViaLiveIosRunnerListener(input: {
  serial: string;
  identifier: string;
  appBundleId?: string;
  timeoutMs?: number;
}): Promise<boolean | undefined> {
  const listener = await probeLiveIosRunnerListener(input.serial);
  if (!listener) return undefined;
  const post = injectedPost ?? postLiveIosRunnerCommand;
  const result = await post(
    listener,
    {
      command: "querySelector",
      selectorKey: "id",
      selectorValue: input.identifier,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    input.timeoutMs ?? IOS_CHROME_QUERY_TIMEOUT_MS,
  );
  if (result.ok === false) {
    if (liveIosRunnerCommandIsBusy(result)) {
      throw new Error(
        liveIosRunnerFailureMessage(
          result,
          "The iOS runner is still finishing a previous command that exceeded its execution watchdog (usually an accessibility capture on a heavy or animating screen).",
        ),
      );
    }
    if (!iosRunnerCommandIsAmbiguous(result)) return undefined;
    try {
      const tree = await snapshotIosDisambiguationTreeViaListener(listener, post, {
        appBundleId: input.appBundleId,
        timeoutMs: input.timeoutMs,
      });
      return resolveNamedControl(tree, { identifier: input.identifier }) !== undefined;
    } catch {
      return undefined;
    }
  }
  const nodes = result.data?.nodes ?? result.nodes ?? [];
  if (isIosRunnerHostProbeTree(nodes)) return undefined;
  if (typeof result.data?.found === "boolean") return result.data.found;
  return nodes.some((node) => (node.identifier?.trim() || input.identifier) === input.identifier);
}

/** Unique-id nodes for interact/preview when chrome-bounded snapshot omitted them. */
export async function identifierNodesViaLiveIosRunnerListener(input: {
  serial: string;
  identifier: string;
  appBundleId?: string;
  timeoutMs?: number;
}): Promise<SnapshotNode[] | undefined> {
  const listener = await probeLiveIosRunnerListener(input.serial);
  if (!listener) return undefined;
  const post = injectedPost ?? postLiveIosRunnerCommand;
  const result = await post(
    listener,
    {
      command: "querySelector",
      selectorKey: "id",
      selectorValue: input.identifier,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    input.timeoutMs ?? IOS_CHROME_QUERY_TIMEOUT_MS,
  );
  if (result.ok === false) {
    if (liveIosRunnerCommandIsBusy(result)) {
      throw new Error(
        liveIosRunnerFailureMessage(
          result,
          "The iOS runner is still finishing a previous command that exceeded its execution watchdog (usually an accessibility capture on a heavy or animating screen).",
        ),
      );
    }
    if (!iosRunnerCommandIsAmbiguous(result)) return [];
    try {
      return await snapshotIosDisambiguationTreeViaListener(listener, post, {
        appBundleId: input.appBundleId,
        timeoutMs: input.timeoutMs,
      });
    } catch {
      return [];
    }
  }
  const nodes = uniqueIdentifierNodes(
    result.data?.nodes ?? result.nodes ?? [],
    input.identifier,
  ).map((node) => ({ ...node, logicalCoordinates: true }));
  if (isIosRunnerHostProbeTree(nodes)) return undefined;
  return nodes;
}

/** Unique-label nodes for interact/preview when chrome-bounded snapshot omitted them. */
export async function labelNodesViaLiveIosRunnerListener(input: {
  serial: string;
  label: string;
  appBundleId?: string;
  timeoutMs?: number;
}): Promise<SnapshotNode[] | undefined> {
  const listener = await probeLiveIosRunnerListener(input.serial);
  if (!listener) return undefined;
  const post = injectedPost ?? postLiveIosRunnerCommand;
  const result = await post(
    listener,
    {
      command: "querySelector",
      selectorKey: "label",
      selectorValue: input.label,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    input.timeoutMs ?? IOS_CHROME_QUERY_TIMEOUT_MS,
  );
  if (result.ok === false) return [];
  const nodes = uniqueLabelNodes(result.data?.nodes ?? result.nodes ?? [], input.label).map(
    (node) => ({
      ...node,
      label: node.label?.trim() || input.label,
      logicalCoordinates: true,
    }),
  );
  if (isIosRunnerHostProbeTree(nodes)) return undefined;
  return nodes;
}

export async function tapViaLiveIosRunnerListener(input: {
  serial: string;
  selectorKey: "label" | "id";
  selectorValue: string;
  appBundleId?: string;
  timeoutMs?: number;
}): Promise<void> {
  const listener = await probeLiveIosRunnerListener(input.serial);
  if (!listener) {
    throw new Error("iOS snapshot needs an active XCTest session");
  }
  const command: LiveIosRunnerCommand = {
    command: "tap",
    selectorKey: input.selectorKey,
    selectorValue: input.selectorValue,
    allowNonHittableCoordinateFallback: true,
    synthesized: true,
    ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
  };
  const timeoutMs = input.timeoutMs ?? 20_000;
  const post = injectedPost ?? postLiveIosRunnerCommand;
  const result = await post(listener, command, timeoutMs);
  if (result.ok !== false) return;
  if (input.selectorKey === "id" && iosRunnerCommandIsAmbiguous(result)) {
    const tree = await snapshotIosDisambiguationTreeViaListener(listener, post, {
      appBundleId: input.appBundleId,
      timeoutMs,
    });
    const resolved = resolveNamedControl(tree, { identifier: input.selectorValue });
    if (!resolved) {
      throw new Error(
        "No unique control matched identifier after ranking same-id nodes. Snapshot the screen and retry with a unique identifier or label.",
      );
    }
    const ranked = await post(
      listener,
      {
        command: "tap",
        synthesized: true,
        x: resolved.point.x,
        y: resolved.point.y,
        ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
      },
      timeoutMs,
    );
    if (ranked.ok === false) {
      throw new Error(liveIosRunnerFailureMessage(ranked, "Live XCTest listener tap failed"));
    }
    return;
  }
  throw new Error(liveIosRunnerFailureMessage(result, "Live XCTest listener tap failed"));
}

const IOS_COMPOSER_IDENTIFIER = "ask.toolbar.textfield";

function uniqueIdentifierNodes(nodes: readonly SnapshotNode[], identifier: string): SnapshotNode[] {
  return nodes.filter((node) => (node.identifier?.trim() || identifier) === identifier);
}

function uniqueLabelNodes(nodes: readonly SnapshotNode[], label: string): SnapshotNode[] {
  return nodes.filter((node) => (node.label?.trim() || label) === label);
}

function nodeHoldsTypedText(node: SnapshotNode | undefined, text: string): boolean {
  if (!node || !text) return false;
  return [node.value, node.label, node.content].some(
    (candidate) => typeof candidate === "string" && candidate.includes(text),
  );
}

async function queryLiveIosIdentifierNodes(
  listener: LiveIosRunnerListener,
  input: { appBundleId?: string; identifier: string; timeoutMs?: number },
): Promise<SnapshotNode[]> {
  const post = injectedPost ?? postLiveIosRunnerCommand;
  const result = await post(
    listener,
    {
      command: "querySelector",
      selectorKey: "id",
      selectorValue: input.identifier,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    input.timeoutMs ?? IOS_CHROME_QUERY_TIMEOUT_MS,
  );
  if (result.ok === false) return [];
  const nodes = result.data?.nodes ?? result.nodes ?? [];
  if (isIosRunnerHostProbeTree(nodes)) {
    throw new Error(
      "Live XCTest listener snapshot is AgentDeviceRunner Copy probe, not the product app",
    );
  }
  return uniqueIdentifierNodes(nodes, input.identifier);
}

export async function typeViaLiveIosRunnerListener(input: {
  serial: string;
  text: string;
  appBundleId?: string;
  selectorKey?: "label" | "id";
  selectorValue?: string;
  timeoutMs?: number;
}): Promise<void> {
  const listener = await probeLiveIosRunnerListener(input.serial);
  if (!listener) {
    throw new Error("iOS snapshot needs an active XCTest session");
  }
  const timeoutMs = input.timeoutMs ?? 20_000;
  let selectorKey = input.selectorKey;
  let selectorValue = input.selectorValue;
  if (!selectorKey || !selectorValue) {
    const composers = await queryLiveIosIdentifierNodes(listener, {
      identifier: IOS_COMPOSER_IDENTIFIER,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
      timeoutMs: Math.min(timeoutMs, IOS_CHROME_QUERY_TIMEOUT_MS),
    });
    if (composers.length !== 1) {
      throw new Error("element not found");
    }
    selectorKey = "id";
    selectorValue = IOS_COMPOSER_IDENTIFIER;
  }
  const command: LiveIosRunnerCommand = {
    command: "type",
    text: input.text,
    allowNonHittableCoordinateFallback: true,
    selectorKey,
    selectorValue,
    ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
  };
  const result = await (injectedPost ?? postLiveIosRunnerCommand)(listener, command, timeoutMs);
  if (result.ok === false) {
    const after = await queryLiveIosIdentifierNodes(listener, {
      identifier: selectorValue,
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
      timeoutMs: Math.min(timeoutMs, IOS_CHROME_QUERY_TIMEOUT_MS),
    }).catch(() => undefined);
    if (after && after.length === 1 && !nodeHoldsTypedText(after[0], input.text)) {
      throw new Error("element not found");
    }
    throw new Error(liveIosRunnerFailureMessage(result, "Live XCTest listener type failed"));
  }
}

export async function postLiveIosRunnerCommand(
  listener: LiveIosRunnerListener,
  command: LiveIosRunnerCommand,
  timeoutMs: number,
): Promise<LiveIosRunnerCommandResult> {
  const socket = await openUsbmuxRunnerSocket(listener.serial, listener.port, timeoutMs);
  try {
    const body = Buffer.from(JSON.stringify(command), "utf8");
    const request = Buffer.concat([
      Buffer.from(
        `POST /command HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
        "utf8",
      ),
      body,
    ]);
    await writeAll(socket, request);
    const raw = await readUntilClose(socket, timeoutMs);
    const sep = raw.indexOf("\r\n\r\n");
    if (sep < 0) throw new Error("Live XCTest listener returned no HTTP body");
    const payload = raw
      .subarray(sep + 4)
      .toString("utf8")
      .trim();
    if (!payload) throw new Error("Live XCTest listener returned an empty snapshot");
    return JSON.parse(payload) as LiveIosRunnerCommandResult;
  } finally {
    socket.destroy();
  }
}

function hostToNetworkPort(port: number): number {
  return ((port & 0xff) << 8) | ((port >>> 8) & 0xff);
}

function buildUsbmuxPlist(fields: Record<string, string | number>): Buffer {
  const entries = Object.entries(fields)
    .map(([key, value]) =>
      typeof value === "number"
        ? `<key>${key}</key><integer>${value}</integer>`
        : `<key>${key}</key><string>${escapeXml(value)}</string>`,
    )
    .join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries}</dict></plist>\n`,
    "utf8",
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function usbmuxPacket(tag: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(USBMUX_HEADER_BYTES);
  header.writeUInt32LE(USBMUX_HEADER_BYTES + payload.length, 0);
  header.writeUInt32LE(USBMUX_PROTOCOL_VERSION, 4);
  header.writeUInt32LE(USBMUX_MESSAGE_PLIST, 8);
  header.writeUInt32LE(tag, 12);
  return Buffer.concat([header, payload]);
}

async function openUsbmuxRunnerSocket(
  serial: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
  const deviceId = await listUsbmuxDeviceId(serial, timeoutMs);
  const socket = await connectUsbmuxd(timeoutMs);
  try {
    await writeAll(
      socket,
      usbmuxPacket(
        2,
        buildUsbmuxPlist({
          MessageType: "Connect",
          ClientVersionString: "relay",
          ProgName: "relay",
          DeviceID: deviceId,
          PortNumber: hostToNetworkPort(port),
        }),
      ),
    );
    const listed = await readUsbmuxPacket(socket, timeoutMs);
    const result = Number(
      listed.toString("utf8").match(/<key>Number<\/key>\s*<integer>(\d+)<\/integer>/u)?.[1],
    );
    if (result !== 0) {
      socket.destroy();
      throw new Error(`usbmux connect to live XCTest listener failed (${result})`);
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function listUsbmuxDeviceId(serial: string, timeoutMs: number): Promise<number> {
  const socket = await connectUsbmuxd(timeoutMs);
  try {
    await writeAll(
      socket,
      usbmuxPacket(
        1,
        buildUsbmuxPlist({
          MessageType: "ListDevices",
          ClientVersionString: "relay",
          ProgName: "relay",
        }),
      ),
    );
    const xml = (await readUsbmuxPacket(socket, timeoutMs)).toString("utf8");
    const deviceId = readUsbmuxDeviceId(xml, serial);
    if (deviceId === undefined)
      throw new Error(`iOS device ${serial} is not available through usbmux`);
    return deviceId;
  } finally {
    socket.destroy();
  }
}

export function readUsbmuxDeviceId(xml: string, serial: string): number | undefined {
  for (const chunk of xml.split("<key>DeviceID</key>").slice(1)) {
    const id = Number(chunk.match(/<integer>(\d+)<\/integer>/u)?.[1]);
    const listed = chunk.match(/<key>SerialNumber<\/key>\s*<string>([^<]+)<\/string>/u)?.[1];
    if (listed === serial && Number.isInteger(id) && id > 0) return id;
  }
  return undefined;
}

async function connectUsbmuxd(timeoutMs: number): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(USBMUXD_SOCKET_PATH);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to usbmuxd"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function writeAll(socket: Socket, payload: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(payload, (error) => (error ? reject(error) : resolve()));
  });
}

async function readUsbmuxPacket(socket: Socket, timeoutMs: number): Promise<Buffer> {
  const header = await readExact(socket, USBMUX_HEADER_BYTES, timeoutMs);
  const length = header.readUInt32LE(0);
  if (length < USBMUX_HEADER_BYTES) throw new Error("Invalid usbmux packet length");
  return await readExact(socket, length - USBMUX_HEADER_BYTES, timeoutMs);
}

async function readExact(socket: Socket, size: number, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let got = 0;
  const deadline = Date.now() + timeoutMs;
  while (got < size) {
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await readChunk(socket, remaining);
    if (!chunk.length) throw new Error("usbmux closed");
    chunks.push(chunk);
    got += chunk.length;
  }
  const all = Buffer.concat(chunks);
  if (all.length > size) socket.unshift(all.subarray(size));
  return all.subarray(0, size);
}

async function readUntilClose(socket: Socket, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await readChunk(socket, Math.max(1, deadline - Date.now())).catch(
      (error: unknown) => {
        if (error instanceof Error && error.message === "usbmux closed") return Buffer.alloc(0);
        throw error;
      },
    );
    if (!chunk.length) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readChunk(socket: Socket, timeoutMs: number): Promise<Buffer> {
  const pending = socket.read() as Buffer | null;
  if (pending?.length) return pending;
  return await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out reading usbmux"));
    }, timeoutMs);
    const onReadable = () => {
      const chunk = socket.read() as Buffer | null;
      if (!chunk?.length) return;
      cleanup();
      resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.alloc(0));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("readable", onReadable);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    socket.on("readable", onReadable);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}
