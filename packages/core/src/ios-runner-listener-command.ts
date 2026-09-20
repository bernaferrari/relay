/**
 * Talk to a LISTENER_READY testCommand runner over usbmux without taking
 * the lease or spawning xcodebuild. Relay’s agent-device session is
 * `relay-ios-<serial>` and does not own the daemon’s live runner; recipes
 * still need named controls. A healthy listener is not a recover-kill.
 */
import type { Socket } from "node:net";
import { openUsbmuxRunnerSocket, readUntilClose, writeAll } from "./ios-usbmux.js";
export { readUsbmuxDeviceId } from "./ios-usbmux.js";
import type { SnapshotNode } from "./device-capabilities.js";
import { resolveNamedControl } from "./device-target-resolution.js";
import { probeLiveIosRunnerListener, type LiveIosRunnerListener } from "./ios-runner-listener.js";
import type { TargetContext } from "./target-context.js";
import { rememberedTargetApplication } from "./device.js";

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

/** Unique closed-home chrome labels — queried while the hamburger is present. */
export const IOS_BOUNDED_HOME_CHROME_LABELS = ["New temporary conversation"] as const;

/** Unique SuperGrok sidebar chrome labels omitted from chrome-bounded snapshot. */
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
    ...(await queryIosChromeLabelsViaListener(
      listener,
      post,
      {
        appBundleId: input.appBundleId,
        includeLabels: hamburgerPresent
          ? [...IOS_BOUNDED_HOME_CHROME_LABELS, ...(input.includeLabels ?? [])]
          : input.includeLabels,
      },
      timeoutMs,
      { includeDefaults: !hamburgerPresent },
    )),
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
  const selectorKey = input.selectorKey;
  const selectorValue = input.selectorValue;
  const command: LiveIosRunnerCommand = {
    command: "type",
    text: input.text,
    allowNonHittableCoordinateFallback: true,
    ...(selectorKey && selectorValue ? { selectorKey, selectorValue } : {}),
    ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
  };
  const result = await (injectedPost ?? postLiveIosRunnerCommand)(listener, command, timeoutMs);
  if (result.ok === false) {
    if (selectorKey === "id" && selectorValue) {
      const after = await queryLiveIosIdentifierNodes(listener, {
        identifier: selectorValue,
        ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
        timeoutMs: Math.min(timeoutMs, IOS_CHROME_QUERY_TIMEOUT_MS),
      }).catch(() => undefined);
      if (after && after.length === 1 && !nodeHoldsTypedText(after[0], input.text)) {
        throw new Error("element not found");
      }
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

export async function snapshotFromLiveIosRunnerListenerIfReady(
  context: TargetContext,
  opts?: {
    interactiveOnly?: boolean;
    timeoutMs?: number;
    includeIdentifiers?: readonly string[];
    includeLabels?: readonly string[];
    requestedChromeOnly?: boolean;
  },
): Promise<SnapshotNode[] | undefined> {
  if (context.kind !== "device" || context.platform !== "ios") return undefined;
  const live = await probeLiveIosRunnerListener(context.serial);
  if (!live) return undefined;
  return await snapshotViaLiveIosRunnerListener({
    serial: context.serial,
    interactiveOnly: opts?.interactiveOnly ?? false,
    appBundleId: await rememberedTargetApplication(context),
    timeoutMs: opts?.timeoutMs,
    ...(opts?.includeIdentifiers?.length ? { includeIdentifiers: opts.includeIdentifiers } : {}),
    ...(opts?.includeLabels?.length ? { includeLabels: opts.includeLabels } : {}),
    ...(opts?.requestedChromeOnly ? { requestedChromeOnly: true } : {}),
  });
}
