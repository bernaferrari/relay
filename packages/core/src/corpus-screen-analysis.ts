import { createHash } from "node:crypto";
import type { CorpusControl } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { isExploreChromeLabel, isUnsafeExploreControlText } from "./explore.js";
import {
  corpusControlStableKey,
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
  // Grok app chrome that leaks under the Settings sheet.
  if (/^grok[-_]/i.test(label)) return true;
  if (
    /^(Grok|Ask|Imagine|Build|Open sidebar|New Message|Ask Anything|Speak|Attach|Auto)$/i.test(
      label,
    )
  )
    return true;
  if (/^Profile picture,/i.test(label)) return true;
  if (/^supergrok-branding/i.test(label)) return true;
  if (/scroll bar|scrollbar|page indicator/i.test(label)) return true;
  if (/^forward$/i.test(label)) return true;
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
  return nodes.some((node) => {
    const id = (node.identifier ?? "").toLocaleLowerCase();
    const label = (node.label ?? "").toLocaleLowerCase();
    return (
      id === "toolbar.back.button" ||
      label === "grok-arrow-left" ||
      (label === "back" &&
        /button|nav/.test(`${node.type ?? ""} ${node.role ?? ""}`.toLocaleLowerCase()))
    );
  });
}

function isSettingsRoot(nodes: SnapshotNode[]): boolean {
  const labels = new Set(nodes.map((node) => (node.label ?? "").trim()).filter(Boolean));
  if (!labels.has("Settings") && ![...labels].some((label) => /settings/i.test(label))) {
    return false;
  }
  return (
    labels.has("Appearance") ||
    labels.has("SuperGrok") ||
    labels.has("Haptics") ||
    labels.has("Usage") ||
    [...labels].some((label) => /appearance|supergrok|haptics/i.test(label))
  );
}

function structuralControlKey(
  nodes: SnapshotNode[],
  node: SnapshotNode,
  fallbackIndex: number,
): string {
  const byIndex = new Map(
    nodes.map((candidate, index) => [candidate.index ?? index, candidate] as const),
  );
  const segments: string[] = [];
  let current: SnapshotNode | undefined = node;
  let guard = 0;
  while (current && guard < 14) {
    const parentIndex = current.parentIndex;
    const type = (current.role ?? current.type ?? "control").trim().toLocaleLowerCase();
    const siblings = nodes.filter((candidate) => candidate.parentIndex === parentIndex);
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
  const owner = `${node.bundleId ?? ""} ${node.identifier ?? ""}`;
  return /(?:^|\s)(?:com\.android\.systemui|com\.touchtype\.swiftkey|com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard)(?::|\/|\.|\s|$)/i.test(
    owner,
  );
}

function actionableAnchor(nodes: SnapshotNode[], node: SnapshotNode): SnapshotNode | undefined {
  if (node.hittable) return node;
  const byIndex = new Map(
    nodes.map((candidate, fallback) => [candidate.index ?? fallback, candidate] as const),
  );
  let parentIndex = node.parentIndex;
  let guard = 0;
  while (parentIndex !== undefined && guard < 16) {
    const parent = byIndex.get(parentIndex);
    if (!parent) return undefined;
    if (parent.hittable) return parent;
    parentIndex = parent.parentIndex;
    guard += 1;
  }
  return undefined;
}

/** Interactive candidates for the corpus crawl. Prefer stable identifiers. */
export function corpusControls(
  nodes: SnapshotNode[],
  options?: { allowSensitive?: boolean; includeToggles?: boolean },
): CorpusControl[] {
  const seen = new Set<string>();
  const nested = isNestedSettingsPage(nodes);
  return nodes
    .filter((node) => node.visibleToUser !== false && node.enabled !== false)
    .flatMap((node, index) => {
      if (isSystemOrKeyboardNode(node)) return [];
      const anchor = actionableAnchor(nodes, node);
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
      if (isCorpusChromeLabel(label)) return [];
      if (!options?.includeToggles && isToggleControl(node, label)) return [];
      if (!options?.allowSensitive && unsafeControlText(label)) return [];
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
          ? corpusControlStableKey(anchor ?? node)
          : structuralControlKey(nodes, anchor ?? node, index);
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
      return [
        {
          id: `${index}-${digest(key).slice(0, 8)}`,
          label,
          stableKey,
          role: node.role ?? node.type,
          target,
        },
      ];
    })
    .slice(0, 60);
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
export function fingerprintCorpusScreen(
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
