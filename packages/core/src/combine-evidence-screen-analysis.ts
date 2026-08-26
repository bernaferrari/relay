import { createHash } from "node:crypto";
import type { CombineEvidenceControl } from "./combine-evidence-session.js";
import type { SnapshotNode } from "./device.js";
import {
  hasProfileChromePrefix,
  hasProfileStableSurfaceTerm,
  isProfileChromeIdentifier,
  isProfileChromeLabel,
  isProfileChromeTitle,
  isSettingsHubRow,
  profileBackAffordances,
} from "./discovery-app-profiles.js";
import { isExploreChromeLabel, isUnsafeExploreControlText } from "./explore.js";
import {
  isSystemInputNode,
  meaningfulNodeIndexes,
  systemInputNodeIndexes,
  wholeScreenNodeIndexes,
} from "./snapshot-app-content.js";
import {
  combineEvidenceControlStableKey,
  observeLocaleStableIdentity,
  observeScreenIdentity,
  stableLabelKey,
} from "./screen-identity.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unsafeControlText(value: string): boolean {
  return isUnsafeExploreControlText(value);
}

function isCorpusChromeLabel(value: string): boolean {
  if (isExploreChromeLabel(value, { excludeLanguageSwitcher: true })) return true;
  const label = value.trim();
  // App chrome that leaks under the Settings sheet. The words belong to the
  // app profile; only the shapes below are platform facts.
  if (isProfileChromeTitle(label) || isProfileChromeLabel(label)) return true;
  if (/^Profile picture,/i.test(label)) return true;
  if (/scroll bar|scrollbar|page indicator/i.test(label)) return true;
  if (/^forward$/i.test(label)) return true;
  return false;
}

/**
 * Chrome named the way every language names it. Word boundaries are the
 * separators an identifier actually uses, so `toolbar.back.button` matches and
 * `toolbar.model.selector.button` — a real, translated control — does not.
 */
const CHROME_IDENTIFIER_SHAPE =
  /(?:^|[.\-_/:])(?:back|close|dismiss|cancel|navigate[-_]?up|scroll ?bar|page ?indicator|search[-_]?voice|search[-_]?bar|collapsing[-_]?appbar|(?:sesl[-_])?floating[-_]?toolbar)(?:[.\-_/:]|$)/i;

/**
 * The name for a control that reads the same in every language: an accessibility
 * identifier, or the SwiftUI LocalizedStringKey behind a translated label.
 *
 * This is what a chrome filter has to be keyed on. Filtering on the visible
 * label made chrome a property of the copy rather than of the control, so the
 * baseline locale was filtered by a word list its own words were on and the
 * other thirty-nine were not: the same Ask screen yielded four controls in
 * English and ten in Italian, and the six that only survived outside English
 * were compared in no language at all, because comparison starts from the
 * baseline's keys.
 */
function localeInvariantIdentity(
  node: SnapshotNode,
  anchor: SnapshotNode | undefined,
): { identifier: string } | { stringKey: string } | undefined {
  const identifier = (anchor?.identifier ?? node.identifier ?? "").trim();
  if (identifier) return { identifier };
  const stringKey =
    stableLabelKey(anchor?.label) ??
    stableLabelKey(anchor?.value) ??
    stableLabelKey(node.label) ??
    stableLabelKey(node.value);
  return stringKey ? { stringKey } : undefined;
}

/**
 * Chrome a background crawl must not activate. The control is still recorded:
 * "Open sidebar" and "Speak" are copy someone translated, and a sweep that
 * never compares them cannot say so.
 *
 * An identifier decides on its own. The label vocabulary is the fallback for
 * trees that expose no stable name — Compose rows, mostly — where the key is
 * structural or label-bound anyway.
 */
function isCrawlChromeControl(input: {
  node: SnapshotNode;
  anchor: SnapshotNode | undefined;
  label: string;
}): boolean {
  const identity = localeInvariantIdentity(input.node, input.anchor);
  if (identity && "identifier" in identity) {
    return (
      isProfileChromeIdentifier(identity.identifier) ||
      CHROME_IDENTIFIER_SHAPE.test(identity.identifier)
    );
  }
  // A LocalizedStringKey is authored English that never changes with the
  // device's language, so the word list reads it consistently everywhere.
  if (identity) return isCorpusChromeLabel(identity.stringKey);
  return isCorpusChromeLabel(input.label);
}

/**
 * An affordance with no copy of its own: a scroll bar, a page indicator, the
 * bare "0"/"1" a switch reports beside itself, an internal handle that leaked
 * into the label slot. Nothing here is text a translator wrote, so it is
 * dropped rather than recorded — and every rule is a role, a shape, or a
 * branded prefix the app stamps identically in every language.
 */
function isNonContentControl(node: SnapshotNode, label: string): boolean {
  const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
  if (/scroll ?bar|page ?indicator/.test(role)) return true;
  const value = label.trim();
  if (/^[01]$/.test(value)) return true;
  if (/^toolbar\./i.test(value)) return true;
  // `grok-gear`, `grok-think`: the app's own handle for an icon, spoken as the
  // label. Identical in all forty languages, so comparing it would report one
  // untranslated string per locale for copy nobody ever wrote.
  if (hasProfileChromePrefix(value)) return true;
  // Legacy shape: platforms that only expose the scroller as a spoken label.
  if (/scroll bar|scrollbar|page indicator/i.test(label)) return true;
  return false;
}

function isToggleControl(node: SnapshotNode, label: string): boolean {
  const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
  if (/\bswitch\b|\btoggle\b/.test(role)) return true;
  if (/^(on|off|1|0)$/i.test((node.value ?? "").trim())) return true;
  if (/^enable\b|^disable\b|^lock\b/i.test(label) && /\bswitch\b/.test(role)) return true;
  return false;
}

function isNestedSettingsPage(nodes: SnapshotNode[]): boolean {
  const appBack = profileBackAffordances().map((label) => label.toLocaleLowerCase());
  return nodes.some((node) => {
    const id = (node.identifier ?? "").toLocaleLowerCase();
    const label = (node.label ?? "").toLocaleLowerCase();
    return (
      id === "toolbar.back.button" ||
      appBack.includes(label) ||
      (label === "back" &&
        /button|nav/.test(`${node.type ?? ""} ${node.role ?? ""}`.toLocaleLowerCase()))
    );
  });
}

/** The settings hub, not one of its children: the hub's own rows are visible. */
function isSettingsRoot(nodes: SnapshotNode[]): boolean {
  const labels = [...new Set(nodes.map((node) => (node.label ?? "").trim()).filter(Boolean))];
  if (!labels.some((label) => /settings/i.test(label))) return false;
  return labels.some((label) => isSettingsHubRow(label) || hasProfileStableSurfaceTerm(label));
}

/**
 * Position of a control in the tree, for screens whose rows carry no identifier
 * or LocalizedStringKey. It is the only key that survives translation, so it has
 * to survive everything else that is not the app: the software keyboard is a
 * sibling of the app's own containers, and counting it would renumber every
 * ordinal beside it, giving one row two keys depending on whether a text field
 * happened to be focused.
 */
function structuralControlKey(
  nodes: SnapshotNode[],
  node: SnapshotNode,
  fallbackIndex: number,
  numbered: ReadonlySet<number>,
): string {
  const structural = nodes.filter((candidate, index) => numbered.has(candidate.index ?? index));
  const byIndex = new Map(
    nodes.map((candidate, index) => [candidate.index ?? index, candidate] as const),
  );
  const segments: string[] = [];
  let current: SnapshotNode | undefined = node;
  let guard = 0;
  while (current && guard < 14) {
    const parentIndex = current.parentIndex;
    const type = (current.role ?? current.type ?? "control").trim().toLocaleLowerCase();
    const siblings = structural.filter((candidate) => candidate.parentIndex === parentIndex);
    const sameType = siblings.filter(
      (candidate) =>
        (candidate.role ?? candidate.type ?? "control").trim().toLocaleLowerCase() === type,
    );
    const ordinal = Math.max(0, sameType.indexOf(current));
    segments.push(`${type}[${ordinal}]`);
    if (parentIndex === undefined) break;
    current = byIndex.get(parentIndex);
    guard += 1;
  }
  return `structure:${segments.reverse().join("/") || `control[${fallbackIndex}]`}`;
}

function isSystemOrKeyboardNode(node: SnapshotNode): boolean {
  if (isSystemInputNode(node)) return true;
  const owner = `${node.bundleId ?? ""} ${node.identifier ?? ""}`;
  return /(?:^|\s)(?:com\.android\.systemui|com\.touchtype\.swiftkey|com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard)(?::|\/|\.|\s|$)/i.test(
    owner,
  );
}

/**
 * The nearest ancestor that can actually be tapped, and that is a row rather
 * than the screen.
 *
 * The anchor lends its identity to the control, which is what collapses a row's
 * label and its subtitle into one action. The application frame must never win
 * that role: XCTest marks SwiftUI cells `hittable:false`, so on iOS the frame is
 * often the only hittable ancestor, and every row on the screen would collapse
 * into a single control keyed by the app itself.
 */
function actionableAnchor(
  nodes: SnapshotNode[],
  node: SnapshotNode,
  wholeScreen: Set<number>,
  fallbackIndex: number,
): SnapshotNode | undefined {
  const isRow = (candidate: SnapshotNode, index: number): boolean =>
    Boolean(candidate.hittable) && !wholeScreen.has(candidate.index ?? index);
  if (isRow(node, fallbackIndex)) return node;
  const byIndex = new Map(
    nodes.map((candidate, fallback) => [candidate.index ?? fallback, candidate] as const),
  );
  let parentIndex = node.parentIndex;
  let guard = 0;
  while (parentIndex !== undefined && guard < 16) {
    const parent = byIndex.get(parentIndex);
    if (!parent) return undefined;
    if (isRow(parent, parentIndex)) return parent;
    parentIndex = parent.parentIndex;
    guard += 1;
  }
  return undefined;
}

const CORPUS_CONTROL_LIMIT = 60;

/**
 * Cap the list without letting chrome crowd out a row. Order is the tree's, so
 * a crawl still walks the screen top to bottom.
 */
function capCombineEvidenceControls(controls: CombineEvidenceControl[]): CombineEvidenceControl[] {
  if (controls.length <= CORPUS_CONTROL_LIMIT) return controls;
  const kept = new Set(
    controls.filter((control) => !control.skipCrawl).slice(0, CORPUS_CONTROL_LIMIT),
  );
  for (const control of controls) {
    if (kept.size >= CORPUS_CONTROL_LIMIT) break;
    kept.add(control);
  }
  return controls.filter((control) => kept.has(control));
}

/**
 * Every comparable control on one screen, each marked with whether an automatic
 * crawl may activate it. Prefer stable identifiers.
 */
export function combineEvidenceControls(
  nodes: SnapshotNode[],
  options?: { allowSensitive?: boolean; includeToggles?: boolean },
): CombineEvidenceControl[] {
  const seen = new Set<string>();
  const nested = isNestedSettingsPage(nodes);
  // The software keyboard lives in the app's own hierarchy on iOS, and the app
  // frame is not a control on the screen it draws.
  const systemInput = systemInputNodeIndexes(nodes);
  const wholeScreen = wholeScreenNodeIndexes(nodes);
  const numbered = meaningfulNodeIndexes(nodes, systemInput);
  const controls = nodes
    .filter((node) => node.visibleToUser !== false && node.enabled !== false)
    .flatMap((node, index) => {
      if (systemInput.has(node.index ?? index) || wholeScreen.has(node.index ?? index)) return [];
      if (isSystemOrKeyboardNode(node)) return [];
      const anchor = actionableAnchor(nodes, node, wholeScreen, index);
      if (anchor && isSystemOrKeyboardNode(anchor)) return [];
      const visibleLabel = (node.label ?? node.value ?? "").trim();
      const identifierOnlyControl =
        !visibleLabel &&
        Boolean(node.identifier) &&
        Boolean(anchor) &&
        !/framelayout|linearlayout|scrollview|content|root/i.test(
          `${node.type ?? ""} ${node.identifier ?? ""}`,
        );
      const label = visibleLabel || (identifierOnlyControl ? node.identifier!.trim() : "");
      if (!label) return [];
      if (isNonContentControl(node, label)) return [];
      if (!options?.includeToggles && isToggleControl(node, label)) return [];
      if (!anchor && node.type !== "Cell" && !node.identifier) return [];
      // Nested pages often still expose the parent settings list in the AX tree.
      if (nested && node.hittable === false && !node.identifier && !anchor) return [];
      const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
      if (
        /statictext|header|heading/.test(role) &&
        node.type !== "Cell" &&
        node.type !== "Button"
      ) {
        return [];
      }
      const semanticKey =
        stableLabelKey(anchor?.label) ??
        stableLabelKey(anchor?.value) ??
        stableLabelKey(node.label) ??
        stableLabelKey(node.value);
      const stableKey =
        anchor?.identifier || node.identifier || semanticKey
          ? combineEvidenceControlStableKey(anchor ?? node)
          : structuralControlKey(nodes, anchor ?? node, index, numbered);
      const target = anchor?.identifier
        ? { identifier: anchor.identifier }
        : anchor?.ref
          ? { ref: anchor.ref }
          : node.identifier
            ? { identifier: node.identifier }
            : node.ref
              ? { ref: node.ref }
              : stableLabelKey(node.label)
                ? { label: node.label! }
                : node.label
                  ? { label: node.label }
                  : undefined;
      if (!target) return [];
      const key = stableKey;
      if (seen.has(key)) return [];
      seen.add(key);
      // Recorded either way, so no word list can decide whether a locale gets
      // compared. Destructive and external rows keep their label check as well
      // as the identifier one: a safety filter may only ever be widened.
      const skipCrawl =
        isCrawlChromeControl({ node, anchor, label }) ||
        (!options?.allowSensitive &&
          (unsafeControlText(label) ||
            unsafeControlText(anchor?.identifier ?? node.identifier ?? "")));
      // The box the text had to fit into. A later locale pass compares against
      // it to see whether a longer translation still had room.
      const rect = node.rect ?? anchor?.rect;
      return [
        {
          id: `${index}-${digest(key).slice(0, 8)}`,
          label,
          stableKey,
          role: node.role ?? node.type,
          target,
          ...(rect ? { rect: { ...rect } } : {}),
          ...(skipCrawl ? { skipCrawl: true as const } : {}),
        },
      ];
    });
  return capCombineEvidenceControls(controls);
}

/** The controls an automatic crawl may activate, in tree order. */
export function crawlableCombineEvidenceControls(
  controls: readonly CombineEvidenceControl[] | undefined,
): CombineEvidenceControl[] {
  return (controls ?? []).filter((control) => !control.skipCrawl);
}

/** Prefer real nav/page titles; never toolbar chrome. */
export function titleFromNodes(nodes: SnapshotNode[], path: string[]): string | undefined {
  const chrome = (label: string) => isCorpusChromeLabel(label) || isExploreChromeLabel(label);

  // NavigationBar.identifier is often the page title on Grok (e.g. "Kids Mode").
  for (const node of nodes) {
    const type = `${node.type ?? ""} ${node.role ?? ""}`.toLocaleLowerCase();
    if (!/navigationbar/.test(type)) continue;
    const id = (node.identifier ?? "").trim();
    if (id && !chrome(id) && !/^toolbar\./i.test(id) && id.length < 80) return id;
    const label = (node.label ?? "").trim();
    if (label && !chrome(label) && label.length < 80) return label;
  }

  // Centered header-ish static text near the top of the sheet.
  const headerCandidates = nodes
    .filter((node) => node.visibleToUser !== false)
    .map((node) => {
      const label = (stableLabelKey(node.label) ?? node.label ?? "").trim();
      if (!label || label.length >= 80 || chrome(label)) return null;
      const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
      if (!/header|heading|statictext|text/.test(role)) return null;
      if (/button|cell|switch/.test(role)) return null;
      const rect = node.rect;
      const y = rect?.y ?? 999;
      const x = rect?.x ?? 0;
      const width = rect?.width ?? 0;
      if (y < 40 || y > 140) return null;
      const centerBonus = width > 40 && x > 120 ? 0 : 20;
      return { label, score: y + centerBonus };
    })
    .filter((item): item is { label: string; score: number } => item !== null)
    .sort((left, right) => left.score - right.score);
  if (headerCandidates[0]) return headerCandidates[0].label;

  if (path.length) return path.at(-1);
  if (isSettingsRoot(nodes)) return "Settings";
  return undefined;
}

/**
 * Locale-stable key for the root; path-scoped key for nested pages so parent
 * AX leakage cannot collapse every settings subpage into one node.
 */
export function fingerprintCombineEvidenceScreen(
  nodes: SnapshotNode[],
  pathKeys: string[] = [],
): {
  fingerprint: string;
  canonicalKey: string;
} {
  const localeStable = observeLocaleStableIdentity(nodes).fingerprint;
  const visualFingerprint = observeScreenIdentity(nodes).fingerprint;
  const canonicalKey =
    pathKeys.length > 0
      ? digest(`relay-corpus-path:v1:${localeStable}:${pathKeys.join(">")}`)
      : localeStable;
  return {
    fingerprint: visualFingerprint,
    canonicalKey,
  };
}
