import type { SnapshotNode } from "./device.js";
import type { LiveIosRunnerCommandPost } from "./ios-runner-listener-command.js";
import type { LiveIosRunnerListener } from "./ios-runner-listener.js";

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

export const IOS_CHROME_QUERY_TIMEOUT_MS = 8_000;

export function chromeValuesToQuery(known: readonly string[], extra?: readonly string[]): string[] {
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

export async function queryIosChromeSelectorsViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    selectorKey: "id" | "label";
    values: readonly string[];
    preserveNonlogicalBounds?: boolean;
    catalogValues?: readonly string[];
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
    if (input.catalogValues && result.data?.systemSurface)
      throw new Error("Requested entrance inspection returned a system surface");
    for (const node of found) {
      nodes.push({
        ...(input.catalogValues
          ? Object.fromEntries(
              Object.entries(node).filter(([key]) => key !== "recordingSelectorSupplemental"),
            )
          : node),
        // Only this same query census assigns provenance; an incoming tag is ignored.
        ...(input.catalogValues
          ? { recordingSelectorSupplemental: !input.catalogValues.includes(value) }
          : {}),
        ...(input.selectorKey === "id"
          ? { identifier: node.identifier?.trim() || value }
          : { label: node.label?.trim() || value }),
        // This direct query uses the runner's XCUIElement.frame presentation,
        // which this adapter already treats as logical. Recording preserves
        // an explicit producer refusal before omitting Application geometry.
        logicalCoordinates: !input.preserveNonlogicalBounds || node.logicalCoordinates !== false,
      });
    }
  }
  return nodes;
}

const IOS_ATTACH_MENU_IDENTIFIER_SET = new Set<string>(IOS_BOUNDED_ATTACH_MENU_IDENTIFIERS);
const IOS_SIDEBAR_CHROME_IDENTIFIER_SET = new Set<string>(IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS);

export function chromeNodeHasIdentifier(
  nodes: readonly SnapshotNode[],
  identifier: string,
): boolean {
  return nodes.some((node) => (node.identifier?.trim() || "") === identifier);
}

function isDeferredChromeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return (
    IOS_ATTACH_MENU_IDENTIFIER_SET.has(trimmed) || IOS_SIDEBAR_CHROME_IDENTIFIER_SET.has(trimmed)
  );
}

export async function queryIosChromeIdentifiersViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    includeIdentifiers?: readonly string[];
    separateRequestedSelectorEvidence?: boolean;
  },
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
      ...(input.separateRequestedSelectorEvidence
        ? { catalogValues: IOS_BOUNDED_HOME_CHROME_IDENTIFIERS }
        : {}),
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
            ...(input.separateRequestedSelectorEvidence
              ? { catalogValues: hamburgerPresent ? [] : IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS }
              : {}),
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
            ...(input.separateRequestedSelectorEvidence ? { catalogValues: [] } : {}),
            ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
          },
          timeoutMs,
        );
  return [...home, ...sidebar, ...attach];
}

export async function queryIosChromeLabelsViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    includeLabels?: readonly string[];
    separateRequestedSelectorEvidence?: boolean;
  },
  timeoutMs: number,
  options?: { includeDefaults?: boolean; catalogLabels?: readonly string[] },
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
      ...(input.separateRequestedSelectorEvidence
        ? { catalogValues: options?.catalogLabels ?? defaults }
        : {}),
      ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
    },
    timeoutMs,
  );
}
