/**
 * Pure target/snapshot matching helpers for recipe execution.
 */
import type { StepPoint, StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { isLegacyPositionalBrowserRef } from "./browser-locator-contract.js";

export function nodeText(node: SnapshotNode): string[] {
  if (node.content !== undefined) return node.content ? [node.content.trim()] : [];
  const type = (node.type ?? node.role ?? "").toLowerCase();
  const value = typeof node.value === "string" ? node.value.trim() : "";
  if (["textfield", "textview", "searchfield", "securetextfield"].includes(type)) {
    // Editable controls expose their placeholder as `label`; it is metadata,
    // never the current content. Preserve an empty value so tests can assert
    // that starting a new conversation really cleared the composer.
    return [value];
  }
  return [node.label, node.value]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

export function nodeMatchesTarget(node: SnapshotNode, target: StepTarget): boolean {
  const roleMatches =
    !target.role ||
    (node.role ?? node.type ?? "").trim().toLocaleLowerCase() ===
      target.role.trim().toLocaleLowerCase();
  if (!roleMatches) return false;
  if (target.identifier && node.identifier === target.identifier) return true;
  if (
    target.ref &&
    !isLegacyPositionalBrowserRef(target.ref) &&
    node.ref?.replace(/^@/, "") === target.ref.replace(/^@/, "")
  )
    return true;
  if (target.label && node.label === target.label) return true;
  if (target.text) {
    const query = target.text.toLowerCase();
    return [...nodeText(node), ...(node.content !== undefined ? [node.label ?? ""] : [])].some(
      (value) => value.toLowerCase().includes(query),
    );
  }
  return false;
}

/** Resolve a deliberate pixel position inside one live semantic element.
 * Duplicate accessibility nodes with the same bounds are one physical anchor;
 * distinct matches are ambiguous and must never turn into a guessed tap. */
export function resolveElementRelativePoint(
  nodes: SnapshotNode[],
  relativeTo: NonNullable<StepPoint["relativeTo"]>,
): { x: number; y: number; bounds: { x: number; y: number; width: number; height: number } } {
  const { target, xRatio, yRatio } = relativeTo;
  if (
    !Number.isFinite(xRatio) ||
    xRatio < 0 ||
    xRatio > 1 ||
    !Number.isFinite(yRatio) ||
    yRatio < 0 ||
    yRatio > 1
  ) {
    throw new Error("element-relative point ratios must be between 0 and 1");
  }
  const selector: StepTarget = target.identifier
    ? { identifier: target.identifier, ...(target.role ? { role: target.role } : {}) }
    : target.ref && !isLegacyPositionalBrowserRef(target.ref)
      ? { ref: target.ref, ...(target.role ? { role: target.role } : {}) }
      : target.label
        ? { label: target.label, ...(target.role ? { role: target.role } : {}) }
        : target.text
          ? { text: target.text, ...(target.role ? { role: target.role } : {}) }
          : {};
  if (!selector.identifier && !selector.ref && !selector.label && !selector.text) {
    throw new Error("element-relative point requires a semantic anchor");
  }
  const candidates = nodes.filter(
    (node) =>
      node.enabled !== false &&
      node.rect !== undefined &&
      node.rect.width > 0 &&
      node.rect.height > 0 &&
      nodeMatchesTarget(node, selector),
  );
  const distinct = candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => {
        const left = candidate.rect!;
        const right = other.rect!;
        return (
          Math.abs(left.x - right.x) <= 1 &&
          Math.abs(left.y - right.y) <= 1 &&
          Math.abs(left.width - right.width) <= 1 &&
          Math.abs(left.height - right.height) <= 1
        );
      }) === index,
  );
  if (distinct.length === 0) throw new Error("element-relative anchor was not found");
  if (distinct.length > 1) throw new Error("element-relative anchor was ambiguous");
  const bounds = distinct[0]!.rect!;
  return {
    x: Math.round(bounds.x + bounds.width * xRatio),
    y: Math.round(bounds.y + bounds.height * yRatio),
    bounds,
  };
}

/** XCTest element refs are snapshots of one moment, not durable selectors.
 * Before replaying a recorded ref on physical iOS, confirm that the current
 * node still carries the stable label or identifier captured with it. Ref
 * reuse must fall through to semantic targeting instead of tapping whatever
 * now happens to own the old token. */
export function refMatchesRecordedTarget(nodes: SnapshotNode[], target: StepTarget): boolean {
  if (!target.ref || isLegacyPositionalBrowserRef(target.ref)) return false;
  const ref = target.ref.replace(/^@/, "");
  const candidate = nodes.find((node) => node.ref?.replace(/^@/, "") === ref);
  if (!candidate) return false;
  if (target.identifier && candidate.identifier !== target.identifier) return false;
  if (target.label && candidate.label !== target.label) return false;
  return true;
}

export function screenIdentityMatches(
  expected: ReadonlySet<string>,
  semanticFingerprint: string,
  visualFingerprint?: string,
): boolean {
  return (
    expected.has(semanticFingerprint) ||
    Boolean(visualFingerprint && expected.has(visualFingerprint))
  );
}

export function textForTarget(nodes: SnapshotNode[], target: StepTarget): string {
  return [
    ...new Set(nodes.filter((node) => nodeMatchesTarget(node, target)).flatMap(nodeText)),
  ].join("\n");
}

export function sameTarget(left: StepTarget, right: StepTarget): boolean {
  return (
    left.identifier === right.identifier &&
    left.ref === right.ref &&
    left.label === right.label &&
    left.role === right.role &&
    left.text === right.text &&
    JSON.stringify(left.relation) === JSON.stringify(right.relation)
  );
}

function localizedStringKeyLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^LocalizedStringKey\(key: "([^"]+)"/u.exec(value)?.[1];
}

const READABLE_TEXT_TYPES = new Set(["statictext", "text", "textview"]);

/** Android helper nodes use `android.widget.TextView`; browsers use `text`. */
function snapshotTypeToken(node: SnapshotNode): string {
  const raw = (node.type ?? node.role ?? "").trim().toLocaleLowerCase();
  return raw.split(".").pop() ?? raw;
}

function readableTextLabel(node: SnapshotNode): string | undefined {
  if (!READABLE_TEXT_TYPES.has(snapshotTypeToken(node))) return undefined;
  const label = localizedStringKeyLabel(node.label) ?? node.label?.trim();
  return label || undefined;
}

function readableDescendantLabels(
  root: SnapshotNode,
  byParent: Map<number, SnapshotNode[]>,
): string[] {
  if (root.index === undefined) return [];
  const labels: string[] = [];
  const queue = [...(byParent.get(root.index) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const label = readableTextLabel(node);
    if (label) labels.push(label);
    if (node.index !== undefined) queue.push(...(byParent.get(node.index) ?? []));
  }
  return labels;
}

export function labelsForIdentifierPrefix(nodes: SnapshotNode[], prefix: string): string[] {
  const byParent = new Map<number, SnapshotNode[]>();
  for (const node of nodes) {
    if (node.parentIndex === undefined) continue;
    const siblings = byParent.get(node.parentIndex) ?? [];
    siblings.push(node);
    byParent.set(node.parentIndex, siblings);
  }

  return [
    ...new Set(
      nodes
        .filter((node) => node.identifier?.startsWith(prefix))
        .flatMap((node) => {
          const own = localizedStringKeyLabel(node.label) ?? node.label?.trim();
          if (own) return [own];
          return readableDescendantLabels(node, byParent);
        })
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** Collect the immediate options inside a semantic container. Structural
 * parent links are preferred; rectangle containment keeps older snapshots
 * useful when a provider does not expose parentIndex. */
export function labelsForScope(nodes: SnapshotNode[], scope: StepTarget): string[] {
  const byParent = new Map<number, SnapshotNode[]>();
  for (const node of nodes) {
    if (node.parentIndex === undefined) continue;
    const children = byParent.get(node.parentIndex) ?? [];
    children.push(node);
    byParent.set(node.parentIndex, children);
  }

  const containedBy = (root: SnapshotNode): SnapshotNode[] => {
    if (!root.rect) return [];
    return nodes.filter((node) => {
      const rect = node.rect;
      return (
        node !== root &&
        rect !== undefined &&
        rect.x >= root.rect!.x &&
        rect.y >= root.rect!.y &&
        rect.x + rect.width <= root.rect!.x + root.rect!.width &&
        rect.y + rect.height <= root.rect!.y + root.rect!.height
      );
    });
  };

  const roots = nodes.filter((node) => nodeMatchesTarget(node, scope));
  const options: SnapshotNode[] = [];
  const seen = new Set<SnapshotNode>();
  for (const root of roots) {
    const linkedChildren = root.index !== undefined ? (byParent.get(root.index) ?? []) : [];
    // Browser snapshots often assign an index but omit parentIndex. Empty
    // linked children must not skip rectangle containment or expect-set
    // sees an empty option set while the menu is visibly open.
    const directChildren = linkedChildren.length > 0 ? linkedChildren : containedBy(root);
    for (const child of directChildren) {
      if (seen.has(child)) continue;
      seen.add(child);
      options.push(child);
    }
  }

  const optionRoles = new Set(["menuitem", "menuitemradio", "option"]);
  const optionLike = options.filter((node) =>
    optionRoles.has((node.role ?? node.type ?? "").trim().toLocaleLowerCase()),
  );
  const labeled = optionLike.length > 0 ? optionLike : options;

  return [
    ...new Set(
      labeled
        .flatMap((node) => {
          const own = localizedStringKeyLabel(node.label) ?? node.label?.trim();
          if (own) return [own];
          return readableDescendantLabels(node, byParent);
        })
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
