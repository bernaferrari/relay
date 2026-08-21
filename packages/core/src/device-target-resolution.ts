import type { StepTargetRelation } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { relationAnchorMatches, resolveFollowingRow } from "./semantic-row-activation.js";

export function center(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

export type SemanticSnapshotTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  role?: string;
  text?: string;
};

export type SnapshotTargetRegion = {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
};

export const INTERACTIVE_SNAPSHOT_ROLES = new Set([
  "button",
  "cell",
  "checkbox",
  "link",
  "securetextfield",
  "slider",
  "switch",
  "textfield",
  "textview",
]);

/**
 * Native bridges commonly serialize a wrapped visual label with a line break,
 * while an authored semantic selector retains ordinary spaces. Treat those as
 * the same text without weakening word or punctuation boundaries. This is
 * intentionally limited to human-readable fields: identifiers remain exact.
 */
function normalizeSemanticText(value: string | undefined): string | undefined {
  // NFC makes an authored composed accent and an AX decomposed accent agree.
  // `toLowerCase` is Unicode-aware but independent of the host machine's
  // locale, so resolution does not vary between workers in a device farm.
  const normalized = value?.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
  return normalized || undefined;
}

/** Mapped "SuperGrok" still matches the live "SuperGrok, X Premium" row.
 * A following word ("SuperGrok More") is a different control. */
export function snapshotLabelMatches(query: string, live: string | undefined): boolean {
  const normalizedQuery = normalizeSemanticText(query);
  const normalizedLive = normalizeSemanticText(live);
  if (!normalizedQuery || !normalizedLive) return false;
  if (normalizedLive === normalizedQuery) return true;
  if (!normalizedLive.startsWith(normalizedQuery)) return false;
  return /^[\s]*[,:;–—([{/-]/u.test(normalizedLive.slice(normalizedQuery.length));
}

function snapshotTextMatches(query: string, live: string | undefined): boolean {
  const normalizedQuery = normalizeSemanticText(query);
  const normalizedLive = normalizeSemanticText(live);
  return Boolean(normalizedQuery && normalizedLive?.includes(normalizedQuery));
}

/** Status-bar crumbs and 20px captions are unique matches that still waste a tap.
 * Prefer a real row; if nothing usable exists, treat the query as unmatched. */
function isUsableTapTarget(node: SnapshotNode): boolean {
  const rect = node.rect;
  if (!rect) return false;
  if (rect.width * rect.height < 40 * 24) return false;
  if (rect.y + rect.height <= 36 && rect.x + rect.width <= 80) return false;
  return true;
}

/** XCTest can mark the application/window container itself as hittable. It is
 * never an activation target for a descendant: using its centre turns a
 * semantic press into an accidental tap in the middle of the app. */
function isActivationContainer(node: SnapshotNode): boolean {
  const role = (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
  return role === "application" || role === "window";
}

/** A resolver can coalesce duplicate native nodes at the same tap point. Keep
 * the representative stable even if a bridge changes traversal order. */
function compareSnapshotNodeIdentity(left: SnapshotNode, right: SnapshotNode): number {
  const leftIndex = left.index ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = right.index ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  for (const field of ["identifier", "ref", "label", "value", "role", "type"] as const) {
    const leftValue = left[field] ?? "";
    const rightValue = right[field] ?? "";
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  for (const field of ["x", "y", "width", "height"] as const) {
    const difference = (left.rect?.[field] ?? 0) - (right.rect?.[field] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

type SnapshotTargetResolution = {
  node: SnapshotNode;
  point: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  usesActivationAncestor: boolean;
  revealDirection?: "up" | "down";
};

/**
 * Resolve one semantic target to a coordinate without pretending an ambiguous
 * accessibility result is safe. Physical iOS apps occasionally expose visible
 * controls as `hittable:false` even though XCTest can activate their bounds.
 * The result retains the exact current-tree node so activation policy never
 * has to infer selector trust from a platform or a recorded coordinate.
 */
function resolveSnapshotTarget(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
  region?: SnapshotTargetRegion,
): SnapshotTargetResolution | undefined {
  const normalized = {
    identifier: target.identifier?.trim().toLocaleLowerCase(),
    ref: target.ref?.replace(/^@/u, "").trim().toLocaleLowerCase(),
    label: normalizeSemanticText(target.label),
    role: target.role?.trim().toLocaleLowerCase(),
    text: normalizeSemanticText(target.text),
  };
  const nodesByIndex = new Map(
    nodes.flatMap((node) => (typeof node.index === "number" ? [[node.index, node] as const] : [])),
  );
  const closestUsableAncestor = (
    node: SnapshotNode,
    requireHittable: boolean,
  ): SnapshotNode | undefined => {
    let parentIndex = node.parentIndex;
    while (typeof parentIndex === "number") {
      const parent = nodesByIndex.get(parentIndex);
      if (!parent) return undefined;
      if (
        (parent.hittable || !requireHittable) &&
        isUsableTapTarget(parent) &&
        !isActivationContainer(parent)
      ) {
        return parent;
      }
      parentIndex = parent.parentIndex;
    }
    return undefined;
  };
  /**
   * A settings row's title is a 37×21 label inside a 335×44 cell, and a
   * physical iPad reports every node in that tree as hittable:false. Pressing
   * the enclosing row is what a person does; requiring the ancestor to claim
   * hittability leaves such a row with no semantic path at all and forces the
   * caller back to a recorded coordinate. The title's own bounds still win
   * whenever they are worth pressing.
   */
  const activationAncestor = (node: SnapshotNode): SnapshotNode | undefined =>
    closestUsableAncestor(node, true) ??
    (isUsableTapTarget(node) ? undefined : closestUsableAncestor(node, false));
  const explicitViewport =
    nodes.find((node) => (node.type ?? node.role)?.toLocaleLowerCase() === "application")?.rect ??
    nodes.find((node) => (node.type ?? node.role)?.toLocaleLowerCase() === "window")?.rect;
  const inferredViewport = nodes
    .filter(
      (node) =>
        node.rect &&
        node.rect.x <= 0 &&
        node.rect.y <= 0 &&
        // A root can legitimately be landscape on a small phone (568×320).
        // Test the short and long sides rather than assuming portrait.
        Math.min(node.rect.width, node.rect.height) >= 320 &&
        Math.max(node.rect.width, node.rect.height) >= 480,
    )
    .sort(
      (left, right) =>
        right.rect!.width * right.rect!.height - left.rect!.width * left.rect!.height,
    )[0]?.rect;
  const viewport = explicitViewport ?? inferredViewport;
  const fixedChromeNodes = viewport
    ? nodes.flatMap((node) => {
        const rect = node.rect;
        if (
          !rect ||
          rect.width < viewport.width * 0.9 ||
          rect.height < 36 ||
          rect.height > viewport.height * 0.3
        ) {
          return [];
        }
        const spansLeftEdge = rect.x <= viewport.x;
        const atTop = spansLeftEdge && rect.y <= viewport.y;
        const atBottom = spansLeftEdge && rect.y + rect.height >= viewport.y + viewport.height;
        return atTop || atBottom ? [node] : [];
      })
    : [];
  const fixedChrome = fixedChromeNodes.flatMap((node) => (node.rect ? [node.rect] : []));
  const fixedChromeIndexes = new Set(
    fixedChromeNodes.flatMap((node) => (typeof node.index === "number" ? [node.index] : [])),
  );
  const belongsToFixedChrome = (node: SnapshotNode): boolean => {
    let current: SnapshotNode | undefined = node;
    while (current) {
      if (typeof current.index === "number" && fixedChromeIndexes.has(current.index)) return true;
      current =
        typeof current.parentIndex === "number" ? nodesByIndex.get(current.parentIndex) : undefined;
    }
    return false;
  };
  const safeTop = Math.max(
    viewport?.y ?? Number.NEGATIVE_INFINITY,
    ...fixedChrome
      .filter((rect) => rect.y <= (viewport?.y ?? 0))
      .map((rect) => rect.y + rect.height),
  );
  const safeBottom = Math.min(
    viewport ? viewport.y + viewport.height : Number.POSITIVE_INFINITY,
    ...fixedChrome
      .filter((rect) => viewport && rect.y + rect.height >= viewport.y + viewport.height)
      .map((rect) => rect.y),
  );
  if (region && (!viewport || viewport.width <= 0 || viewport.height <= 0)) return undefined;
  const candidates = nodes
    .filter((node) => {
      if (
        !node.rect ||
        node.rect.width <= 0 ||
        node.rect.height <= 0 ||
        node.enabled === false ||
        node.visibleToUser === false
      ) {
        return false;
      }
      if (!isUsableTapTarget(node) && !closestUsableAncestor(node, false)) return false;
      if (
        normalized.role &&
        (node.role ?? node.type ?? "").trim().toLocaleLowerCase() !== normalized.role
      ) {
        return false;
      }
      if (region && viewport) {
        const point = center(node.rect);
        const x = (point.x - viewport.x) / viewport.width;
        const y = (point.y - viewport.y) / viewport.height;
        if (
          (region.minX !== undefined && x < region.minX) ||
          (region.maxX !== undefined && x > region.maxX) ||
          (region.minY !== undefined && y < region.minY) ||
          (region.maxY !== undefined && y > region.maxY)
        ) {
          return false;
        }
      }
      if (normalized.identifier) {
        return node.identifier?.trim().toLocaleLowerCase() === normalized.identifier;
      }
      if (normalized.ref)
        return node.ref?.replace(/^@/u, "").toLocaleLowerCase() === normalized.ref;
      if (normalized.label) return snapshotLabelMatches(normalized.label, node.label);
      if (normalized.text) {
        return [node.label, node.value, node.identifier].some((value) =>
          snapshotTextMatches(normalized.text!, value),
        );
      }
      return false;
    })
    .map((node) => {
      const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
      const activationNode = activationAncestor(node);
      const activationRect = activationNode?.rect ?? node.rect!;
      const point = center(activationRect);
      const isFixedChromeControl =
        (node.hittable === true || activationNode !== undefined) &&
        (belongsToFixedChrome(node) ||
          Boolean(activationNode && belongsToFixedChrome(activationNode))) &&
        fixedChrome.some(
          (rect) =>
            point.x >= rect.x &&
            point.x <= rect.x + rect.width &&
            point.y >= rect.y &&
            point.y <= rect.y + rect.height,
        );
      // Device input coordinates are always expressed in the current viewport.
      // A reused Compose tree can retain translated document geometry after a
      // scroll; never let that stale geometry become a negative device tap.
      if (point.x < 0 || point.y < 0) return undefined;
      if (
        viewport &&
        (point.x < Math.max(0, viewport.x) ||
          point.x > viewport.x + viewport.width ||
          point.y < Math.max(0, viewport.y) ||
          point.y > viewport.y + viewport.height)
      ) {
        return undefined;
      }
      return {
        node,
        point,
        bounds: activationRect,
        usesActivationAncestor: activationNode !== undefined,
        isFixedChromeControl,
        /** A plain text heading is allowed to lose to its owned row. Two
         * independently activatable locations, however, are a real ambiguity
         * when one lives in sticky chrome and the other in scroll content. */
        independentlyActivatable: node.hittable === true || activationNode !== undefined,
        ...(!isFixedChromeControl && point.y < safeTop
          ? { revealDirection: "up" as const }
          : !isFixedChromeControl && point.y > safeBottom
            ? { revealDirection: "down" as const }
            : {}),
        // Compose often places the title inside an unlabeled tappable row.
        // Prefer that row over an identically named section heading or
        // caption, while retaining the child label for semantic matching.
        rank:
          (INTERACTIVE_SNAPSHOT_ROLES.has(role) ? 4 : 0) +
          (node.hittable ? 2 : 0) +
          (activationNode ? 3 : 0) +
          (normalized.label && node.label?.trim().toLocaleLowerCase() === normalized.label ? 8 : 0),
        area: activationRect.width * activationRect.height,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  if (candidates.length === 0) return undefined;

  const activeLocations = candidates
    .filter((candidate) => candidate.independentlyActivatable)
    .filter(
      (candidate, index, list) =>
        list.findIndex(
          (other) =>
            Math.abs(other.point.x - candidate.point.x) <= 4 &&
            Math.abs(other.point.y - candidate.point.y) <= 4,
        ) === index,
    );
  // A label-only target cannot tell a persistent toolbar/footer control from a
  // separately owned content row with the same copy. Ranking the chrome button
  // above a Compose row would make the offline proof (and the live resolver)
  // confidently press the wrong thing, so leave this as a repairable
  // ambiguity. Identifier/ref paths remain deliberately unaffected.
  if (
    !normalized.identifier &&
    !normalized.ref &&
    activeLocations.some((candidate) => candidate.isFixedChromeControl) &&
    activeLocations.some((candidate) => !candidate.isFixedChromeControl)
  ) {
    return undefined;
  }

  const bestRank = Math.max(...candidates.map((candidate) => candidate.rank));
  const best = candidates.filter((candidate) => candidate.rank === bestRank);
  const distinct = best.filter(
    (candidate, index) =>
      best.findIndex(
        (other) =>
          Math.abs(other.point.x - candidate.point.x) <= 4 &&
          Math.abs(other.point.y - candidate.point.y) <= 4,
      ) === index,
  );
  if (distinct.length !== 1) return undefined;

  const selected = best
    .filter(
      (candidate) =>
        Math.abs(candidate.point.x - distinct[0]!.point.x) <= 4 &&
        Math.abs(candidate.point.y - distinct[0]!.point.y) <= 4,
    )
    .sort(
      (left, right) =>
        left.area - right.area ||
        (right.node.depth ?? 0) - (left.node.depth ?? 0) ||
        compareSnapshotNodeIdentity(left.node, right.node),
    )[0];
  return selected
    ? {
        node: selected.node,
        point: selected.point,
        bounds: selected.bounds,
        usesActivationAncestor: selected.usesActivationAncestor,
        ...("revealDirection" in selected && selected.revealDirection
          ? { revealDirection: selected.revealDirection }
          : {}),
      }
    : undefined;
}

export function resolveSnapshotTargetPoint(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
  region?: SnapshotTargetRegion,
): { x: number; y: number } | undefined {
  const resolution = resolveSnapshotTarget(nodes, target, region);
  return resolution?.revealDirection ? undefined : resolution?.point;
}

export function resolveSnapshotTargetRevealDirection(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
): "up" | "down" | undefined {
  return resolveSnapshotTarget(nodes, target)?.revealDirection;
}

/**
 * Reveal prefers identifier → ref → label → text independently. A combined
 * `{ identifier, label }` query must not hide a unique live label when the
 * recorded identifier has drifted ("SuperGrok" vs "SuperGrok, X Premium").
 */
export function resolveSemanticRevealTarget(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
  region?: SnapshotTargetRegion,
) {
  const role = target.role ? { role: target.role } : {};
  const methods: SemanticSnapshotTarget[] = [
    ...(target.identifier ? [{ identifier: target.identifier, ...role }] : []),
    ...(target.ref ? [{ ref: target.ref, ...role }] : []),
    ...(target.label ? [{ label: target.label, ...role }] : []),
    ...(target.text ? [{ text: target.text, ...role }] : []),
  ];
  for (const method of methods.length > 0 ? methods : [target]) {
    const hit = resolveSnapshotTarget(nodes, method, region);
    if (hit) return hit;
  }
  return undefined;
}

export type NamedControlTarget = {
  identifier?: string;
  label?: string;
  role?: string;
  text?: string;
  relation?: StepTargetRelation;
  point?: { x: number; y: number };
  /** Exact Android package allowed to replace the current foreground app. */
  expectedApp?: string;
};

export type NamedControlMethod = "identifier" | "label" | "text" | "relation" | "point";

export type NamedControlResolution = {
  method: NamedControlMethod;
  point: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * The current accessibility snapshot proved a unique semantic match whose
   * native selector is specifically untrustworthy. Use the live snapshot's
   * activation bounds instead. This is never inferred from platform alone and
   * never carries a recorded point forward.
   */
  activation?: "snapshot-point";
};

export type NamedControlResolutionFailure = {
  status: "absent" | "ambiguous" | "offscreen" | "unhittable";
  method: Exclude<NamedControlMethod, "point">;
  matches: number;
  detail: string;
};

export type NamedControlResolutionOutcome =
  | { status: "resolved"; resolution: NamedControlResolution }
  | NamedControlResolutionFailure;

/** Resolve a stable heading to the value/control row immediately after it.
 * This models structure, not geometry: the anchor and row must be siblings,
 * and that next sibling must contain one unique actionable location. */
export function resolveFollowingRowControl(
  nodes: SnapshotNode[],
  relation: StepTargetRelation,
): NamedControlResolutionOutcome {
  const outcome = resolveFollowingRow(nodes, relation);
  return outcome.status === "resolved"
    ? {
        status: "resolved",
        resolution: {
          method: "relation",
          point: outcome.point,
          bounds: outcome.bounds,
          activation: "snapshot-point",
        },
      }
    : { ...outcome, method: "relation" };
}

export type SemanticActivationPreflight =
  | { status: "proven"; resolution: NamedControlResolution }
  | { status: "blocked"; code: "absent" | "ambiguous" | "heading-only-noop"; detail: string };

/** Pure offline selector check over a frozen raw accessibility tree. It uses
 * the same resolver as the device path, so a repair can be validated without
 * reconnecting hardware. */
export function preflightSemanticActivation(
  nodes: SnapshotNode[],
  target: NamedControlTarget,
): SemanticActivationPreflight {
  if (target.relation) {
    const related = resolveFollowingRowControl(nodes, target.relation);
    return related.status === "resolved"
      ? { status: "proven", resolution: related.resolution }
      : {
          status: "blocked",
          code: related.status === "ambiguous" ? "ambiguous" : "absent",
          detail: related.detail,
        };
  }
  const outcome = resolveNamedControlOutcome(nodes, target);
  if (outcome.status !== "resolved") {
    return {
      status: "blocked",
      code: outcome.status === "ambiguous" ? "ambiguous" : "absent",
      detail: outcome.detail,
    };
  }
  const semantic = {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
  };
  const matches = nodes.filter((node) =>
    relationAnchorMatches(node, {
      kind: "following-row",
      anchor: semantic,
    }),
  );
  const descriptiveOnly =
    matches.length > 0 &&
    matches.every((node) => {
      const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
      return node.hittable !== true && /heading|header|statictext|textview/.test(role);
    });
  if (descriptiveOnly && outcome.resolution.activation !== "snapshot-point") {
    const relation = resolveFollowingRowControl(nodes, {
      kind: "following-row",
      anchor: semantic,
    });
    if (relation.status === "resolved") {
      return {
        status: "blocked",
        code: "heading-only-noop",
        detail:
          "selector resolves only to descriptive heading bounds; use a following-row semantic relation",
      };
    }
  }
  return { status: "proven", resolution: outcome.resolution };
}

export function explicitPointResolution(
  point: { x: number; y: number } | undefined,
): NamedControlResolution | undefined {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return {
    method: "point",
    point: { x: point.x, y: point.y },
    bounds: { x: point.x, y: point.y, width: 1, height: 1 },
  };
}

/**
 * Shared mouse + recipe tap policy: identifier → label → text → explicit point.
 * Ambiguous labels do not guess; callers must supply a point fallback.
 * A non-hittable child with a current hittable ancestor uses that ancestor's
 * bounds. An authored row whose tree does not report selector hittability uses
 * its unique live bounds instead of its saved point. Otherwise selectors stay
 * first, and a caller point remains only the fallback when no name resolves.
 */
export function resolveNamedControlOutcome(
  nodes: SnapshotNode[],
  target: NamedControlTarget,
): NamedControlResolutionOutcome {
  const failures: NamedControlResolutionFailure[] = [];
  const resolve = (
    method: "identifier" | "label" | "text",
    value: string | undefined,
  ): NamedControlResolution | undefined => {
    if (!value?.trim()) return undefined;
    const semanticTarget = {
      [method]: value,
      ...(target.role ? { role: target.role } : {}),
    };
    const hit = resolveSnapshotTarget(nodes, semanticTarget);
    // Named control activation is not a reveal operation. Off-screen semantic
    // matches must be revealed first or resolved again from a fresh tree.
    if (hit?.revealDirection) {
      failures.push({
        status: "offscreen",
        method,
        matches: 1,
        detail: `matched control requires reveal ${hit.revealDirection}`,
      });
      return undefined;
    }
    if (!hit) {
      const normalizedValue = normalizeSemanticText(value)!;
      const normalizedRole = target.role?.trim().toLocaleLowerCase();
      const matches = nodes.filter((node) => {
        if (
          normalizedRole &&
          (node.role ?? node.type ?? "").trim().toLocaleLowerCase() !== normalizedRole
        ) {
          return false;
        }
        if (method === "identifier") {
          return node.identifier?.trim().toLocaleLowerCase() === normalizedValue;
        }
        if (method === "label") {
          return snapshotLabelMatches(normalizedValue, node.label);
        }
        return [node.label, node.value, node.identifier].some((candidate) =>
          snapshotTextMatches(normalizedValue, candidate),
        );
      });
      const usable = matches.filter(
        (node) =>
          node.enabled !== false &&
          node.visibleToUser !== false &&
          node.rect !== undefined &&
          node.rect.width > 0 &&
          node.rect.height > 0 &&
          isUsableTapTarget(node),
      );
      const distinctLocations = usable.filter(
        (candidate, index) =>
          usable.findIndex((other) => {
            const left = candidate.rect!;
            const right = other.rect!;
            return (
              Math.abs(left.x - right.x) <= 4 &&
              Math.abs(left.y - right.y) <= 4 &&
              Math.abs(left.width - right.width) <= 4 &&
              Math.abs(left.height - right.height) <= 4
            );
          }) === index,
      );
      const diagnosticViewport =
        nodes.find((node) =>
          ["application", "window"].includes(
            (node.type ?? node.role ?? "").trim().toLocaleLowerCase(),
          ),
        )?.rect ??
        nodes
          .filter((node) => node.rect && node.rect.x <= 0 && node.rect.y <= 0)
          .sort(
            (left, right) =>
              right.rect!.width * right.rect!.height - left.rect!.width * left.rect!.height,
          )[0]?.rect;
      const outsideViewport = Boolean(
        diagnosticViewport &&
        usable.some((node) => {
          const point = center(node.rect!);
          return (
            point.x < diagnosticViewport.x ||
            point.x > diagnosticViewport.x + diagnosticViewport.width ||
            point.y < diagnosticViewport.y ||
            point.y > diagnosticViewport.y + diagnosticViewport.height
          );
        }),
      );
      const status =
        matches.length === 0
          ? "absent"
          : usable.length === 0
            ? "unhittable"
            : distinctLocations.length > 1
              ? "ambiguous"
              : outsideViewport
                ? "offscreen"
                : "unhittable";
      failures.push({
        status,
        method,
        matches: matches.length,
        detail:
          status === "absent"
            ? "selector is not present in the current accessibility tree"
            : status === "ambiguous"
              ? `selector matches ${distinctLocations.length} different control locations`
              : status === "offscreen"
                ? "selector exists outside the current viewport"
                : "selector exists but has no unique actionable bounds",
      });
      return undefined;
    }
    const hasVerifiedCurrentPoint =
      (hit.node.hittable === false && hit.usesActivationAncestor) ||
      (hit.node.hittable === undefined && explicitPointResolution(target.point) !== undefined);
    return {
      method,
      point: hit.point,
      bounds: hit.bounds,
      ...(hasVerifiedCurrentPoint ? { activation: "snapshot-point" as const } : {}),
    };
  };

  const byIdentifier = resolve("identifier", target.identifier);
  if (byIdentifier) return { status: "resolved", resolution: byIdentifier };

  const byLabel = resolve("label", target.label);
  if (byLabel) return { status: "resolved", resolution: byLabel };
  const byText = resolve("text", target.text);
  if (byText) return { status: "resolved", resolution: byText };
  if (target.relation) {
    const related = resolveFollowingRowControl(nodes, target.relation);
    if (related.status === "resolved") return related;
    failures.push(related);
  }
  const point = explicitPointResolution(target.point);
  if (point) return { status: "resolved", resolution: point };
  return (
    failures.find((failure) => failure.status === "ambiguous") ??
    failures.find((failure) => failure.status === "offscreen") ??
    failures.find((failure) => failure.status === "unhittable") ??
    failures[0] ?? {
      status: "absent",
      method: "label",
      matches: 0,
      detail: "target has no semantic selector",
    }
  );
}

export function resolveNamedControl(
  nodes: SnapshotNode[],
  target: NamedControlTarget,
): NamedControlResolution | undefined {
  const outcome = resolveNamedControlOutcome(nodes, target);
  return outcome.status === "resolved" ? outcome.resolution : undefined;
}
