import type { SnapshotNode, SnapshotState, StepTarget } from "../context/server";

/**
 * Snapshot geometry + addressing helpers. Pure functions of the snapshot and
 * a click point, kept dependency-light so they are trivially testable later
 * (the app package has no test harness today — plan 003 note). Used by the
 * stage element picker and the recorder.
 */

/** Smallest a11y node whose rect contains the fractional point (0..1 of bounds). */
export function nodeAtPoint(snap: SnapshotState, fx: number, fy: number): SnapshotNode | null {
  if (!snap?.bounds) return null;
  const bw = snap.bounds.width;
  const bh = snap.bounds.height;
  let best: SnapshotNode | null = null;
  let bestArea = Infinity;
  for (const n of snap.nodes) {
    if (!n.rect) continue;
    const nx = n.rect.x / bw;
    const ny = n.rect.y / bh;
    const nw = n.rect.width / bw;
    const nh = n.rect.height / bh;
    if (fx >= nx && fx <= nx + nw && fy >= ny && fy <= ny + nh) {
      const area = nw * nh;
      if (area > 0 && area < bestArea) {
        best = n;
        bestArea = area;
      }
    }
  }
  return best;
}

function rectArea(n: SnapshotNode): number {
  const r = n.rect;
  return r ? r.width * r.height : 0;
}

function contains(a: SnapshotNode, b: SnapshotNode): boolean {
  // Does a's rect geometrically contain b's rect?
  const ra = a.rect;
  const rb = b.rect;
  if (!ra || !rb) return false;
  return (
    ra.x <= rb.x &&
    ra.y <= rb.y &&
    ra.x + ra.width >= rb.x + rb.width &&
    ra.y + ra.height >= rb.y + rb.height
  );
}

/**
 * Pick the nodes worth offering as hover-inspect targets on the stage.
 *
 * Three filters, in order:
 *  1. Actionable + labelled — has a rect AND (`hittable` OR `ref` OR a
 *     non-empty label/value). Bare layout containers with no semantic payload
 *     are dropped.
 *  2. Not a full-screen tint — area under 35% of the snapshot bounds, so the
 *     root window and other backdrop nodes never paint over the screenshot
 *     (the "even the bg gets the overlay" bug).
 *  3. Leaf-ish — dropped when another candidate's rect sits strictly inside it
 *     AND it is more than 4× that candidate's area (a big wrapper around a
 *     real target). Keeps genuinely leaf-sized containers; removes only the
 *     wrappers that exist solely to hold smaller interactive children.
 *
 * Pure; safe to unit-test once the app package has a harness (plan 003 note).
 */
export function overlayCandidates(
  nodes: SnapshotNode[],
  bounds: { width: number; height: number } | undefined,
): SnapshotNode[] {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [];
  const cap = bounds.width * bounds.height * 0.35;
  const actionable = nodes.filter((n) => {
    if (!n.rect) return false;
    const label = (n.label ?? n.value ?? "").trim();
    if (!(n.hittable || n.ref || label)) return false;
    return n.rect.width * n.rect.height < cap;
  });
  return actionable.filter(
    (a) => !actionable.some((b) => b !== a && contains(a, b) && rectArea(a) > 4 * rectArea(b)),
  );
}

/** Smallest candidate whose rect contains the fractional point (0..1 of bounds). */
export function candidateAtPoint(
  candidates: SnapshotNode[],
  bounds: { width: number; height: number } | undefined,
  fx: number,
  fy: number,
): SnapshotNode | null {
  if (!bounds) return null;
  let best: SnapshotNode | null = null;
  let bestArea = Infinity;
  for (const n of candidates) {
    if (!n.rect) continue;
    const nx = n.rect.x / bounds.width;
    const ny = n.rect.y / bounds.height;
    const nw = n.rect.width / bounds.width;
    const nh = n.rect.height / bounds.height;
    if (fx >= nx && fx <= nx + nw && fy >= ny && fy <= ny + nh) {
      const area = nw * nh;
      if (area > 0 && area < bestArea) {
        best = n;
        bestArea = area;
      }
    }
  }
  return best;
}

/** Build a node lookup by `index` (falling back to array position). */
function indexMap(nodes: SnapshotNode[]): Map<number, SnapshotNode> {
  const m = new Map<number, SnapshotNode>();
  nodes.forEach((n, i) => m.set(n.index ?? i, n));
  return m;
}

/**
 * Walk parentIndex links from a node up to the root (node first). Falls back
 * to geometric ancestry (the chain of nodes whose rects contain the node's
 * rect, sorted by area ascending) when parentIndex is absent on every node —
 * the feature must stay alive if a backend withholds indices.
 */
export function ancestryOf(snap: SnapshotState, node: SnapshotNode): SnapshotNode[] {
  const nodes = snap?.nodes ?? [];
  if (nodes.length === 0) return [node];

  // Prefer structural parentIndex links when at least one node carries them.
  const hasParentIndex = nodes.some((n) => typeof n.parentIndex === "number");
  if (hasParentIndex) {
    const byIndex = indexMap(nodes);
    const chain: SnapshotNode[] = [node];
    let cur: SnapshotNode | undefined = node;
    const guard = new Set<number>();
    const startKey = typeof node.index === "number" ? node.index : nodes.indexOf(node);
    guard.add(startKey);
    while (cur && typeof cur.parentIndex === "number") {
      const key = cur.parentIndex;
      if (guard.has(key)) break; // cycle guard
      guard.add(key);
      const parent = byIndex.get(key);
      if (!parent || parent === cur) break;
      chain.push(parent);
      cur = parent;
    }
    return chain;
  }

  // Geometric fallback: nodes whose rect contains `node`, smallest-first
  // (node itself appears first because it contains itself with equal area).
  return nodes
    .filter((n) => contains(n, node) && rectArea(n) >= rectArea(node))
    .sort((a, b) => rectArea(a) - rectArea(b));
}

/** Short human label for a node — role or label/value/identifier, for breadcrumbs. */
export function shortLabel(n: SnapshotNode | null | undefined): string {
  if (!n) return "";
  const label = (n.label ?? n.value ?? n.identifier ?? "").trim();
  if (label) return label.length > 18 ? `${label.slice(0, 17)}…` : label;
  return n.role ?? n.type ?? "node";
}

/** Strategy option the picker offers for a node. */
export type PickStrategy =
  | { id: "ref"; kind: "ref"; ref: string; describe: string }
  | { id: "label"; kind: "label"; label: string; describe: string }
  | { id: "text"; kind: "text"; text: string; describe: string }
  | { id: "point"; kind: "point"; x: number; y: number; describe: string };

function describePoint(x: number, y: number): string {
  return `${x}, ${y}`;
}

function clip(s: string, max = 40): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Human strategy options for a node, best first. `ref` and `label`/`text` are
 * included only when present; `point` is always offered (last resort). The
 * `text` strategy uses a shortened contains-match on the node's value/label,
 * distinct from the exact-equality `label` strategy.
 */
export function strategiesFor(
  node: SnapshotNode | null,
  snap: SnapshotState,
  fx: number,
  fy: number,
): PickStrategy[] {
  const out: PickStrategy[] = [];
  const bounds = snap?.bounds;
  const w = bounds?.width ?? 1;
  const h = bounds?.height ?? 1;
  const x = Math.round(fx * w);
  const y = Math.round(fy * h);

  if (node?.ref) {
    const ref = node.ref.startsWith("@") ? node.ref : `@${node.ref}`;
    out.push({ id: "ref", kind: "ref", ref, describe: ref });
  }
  const labelRaw = (node?.label ?? node?.value ?? "").trim();
  if (labelRaw) {
    out.push({
      id: "label",
      kind: "label",
      label: labelRaw,
      describe: `label "${clip(labelRaw, 40)}"`,
    });
  }
  // text: a distinct, contains-style target derived from value or a longer label.
  const textRaw = node?.value?.trim() || node?.label?.trim() || "";
  if (textRaw && textRaw !== labelRaw) {
    const t = clip(textRaw, 40);
    out.push({ id: "text", kind: "text", text: t, describe: `text ~ "${t}"` });
  } else if (textRaw && textRaw.length > 24) {
    // long label — offer a contains text-match in addition to exact label
    const t = clip(textRaw, 40);
    out.push({ id: "text", kind: "text", text: t, describe: `text ~ "${t}"` });
  }
  out.push({ id: "point", kind: "point", x, y, describe: describePoint(x, y) });
  return out;
}

/**
 * Build the StepTarget the runner records, honoring the user's explicit
 * strategy choice: the chosen strategy field is first-class, `point` is the
 * emergency fallback, and other strategies are omitted (the user picked the
 * strategy; point is the emergency fallback).
 */
export function targetFromStrategy(
  strategy: PickStrategy,
  fx: number,
  fy: number,
  bounds: { width: number; height: number } | undefined,
): StepTarget {
  const w = bounds?.width ?? 1;
  const h = bounds?.height ?? 1;
  const point = { x: Math.round(fx * w), y: Math.round(fy * h) };
  switch (strategy.kind) {
    case "ref":
      return { ref: strategy.ref, point };
    case "label":
      return { label: strategy.label, point };
    case "text":
      return { text: strategy.text, point };
    case "point":
      return { point };
  }
}
