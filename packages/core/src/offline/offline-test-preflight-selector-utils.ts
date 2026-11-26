import type {
  NormalizedSemanticNode,
  OfflineTestPreflightSelector,
  RecipeStep,
  StepTarget,
} from "@relay/protocol";

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function targetDescription(target: StepTarget): string {
  if (target.relation?.kind === "following-row") {
    return `the row following ${targetDescription(target.relation.anchor)}`;
  }
  return (
    target.identifier ??
    target.ref ??
    target.label ??
    target.text ??
    (target.point ? "point" : "target")
  );
}

function candidate(node: NormalizedSemanticNode) {
  return {
    role: node.role,
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { value: node.value } : {}),
  };
}

function compareCandidates(left: NormalizedSemanticNode, right: NormalizedSemanticNode): number {
  const key = (node: NormalizedSemanticNode) =>
    [node.role, node.identifier ?? "", node.label ?? "", node.value ?? ""].join("\u0000");
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function boundedCandidates(nodes: readonly NormalizedSemanticNode[]) {
  return [...nodes].sort(compareCandidates).slice(0, 5).map(candidate);
}

export function uniqueReferences(references: readonly string[]): string[] {
  return [...new Set(references.filter((reference) => reference.trim()))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function targetSummary(target: StepTarget): OfflineTestPreflightSelector["target"] {
  return {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.ref ? { ref: target.ref } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
    ...(target.relation ? { relation: structuredClone(target.relation) } : {}),
    ...(target.point ? { hasPointFallback: true } : {}),
  };
}

export function revealPositions(
  step: Extract<RecipeStep, { kind: "reveal" }>,
): NonNullable<OfflineTestPreflightSelector["revealPositions"]> | undefined {
  const positions = (step.navigation ?? [])
    .map((navigation) => ({
      surfaceId: navigation.surfaceId,
      captureId: navigation.captureId,
      targetOrder: navigation.targetOrder,
      targetDocumentY: navigation.targetDocumentY,
      direction: step.direction ?? "auto",
    }))
    .sort(
      (left, right) =>
        left.targetDocumentY - right.targetDocumentY ||
        (left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0) ||
        (left.captureId < right.captureId ? -1 : left.captureId > right.captureId ? 1 : 0),
    );
  return positions.length ? positions : undefined;
}

export function observationsFromNavigation(
  navigation: Extract<RecipeStep, { kind: "reveal" }>["navigation"],
): Array<{ nodes: NormalizedSemanticNode[] }> {
  return (navigation ?? []).map((plan) => ({
    nodes: plan.anchors.map((anchor) => ({
      role: anchor.role ?? "unknown",
      ...(anchor.target.identifier ? { identifier: anchor.target.identifier } : {}),
      ...((anchor.label ?? anchor.target.label)
        ? { label: anchor.label ?? anchor.target.label }
        : {}),
      ...(anchor.value ? { value: anchor.value } : {}),
      ...(anchor.enabled !== undefined ? { enabled: anchor.enabled } : {}),
    })),
  }));
}

export function matchesTarget(nodes: readonly NormalizedSemanticNode[], target: StepTarget) {
  const semantic = target.relation?.anchor ?? target;
  const role = normalize(semantic.role);
  const candidates = nodes.filter((node) => !role || normalize(node.role) === role);
  // Runtime resolution intentionally tries durable identifiers first, then
  // visible copy. Requiring every authored hint to match simultaneously makes
  // an identifier refresh look like a broken control even when its reviewed
  // label fallback is present.
  const strategies: Array<(node: NormalizedSemanticNode) => boolean> = [];
  const identifier = normalize(semantic.identifier);
  const label = normalize(semantic.label);
  const text = normalize(semantic.text);
  if (identifier) strategies.push((node) => normalize(node.identifier) === identifier);
  if (label) strategies.push((node) => normalize(node.label) === label);
  if (text) {
    strategies.push((node) =>
      [node.label, node.value, node.identifier].some((value) => normalize(value)?.includes(text)),
    );
  }
  for (const strategy of strategies) {
    const matches = candidates.filter(strategy);
    if (matches.length) return matches;
  }
  return [];
}

export function isDynamicSharedConversations(title: string | undefined): boolean {
  return title?.trim().toLocaleLowerCase() === "shared conversations";
}

/** Shared Conversations is user-generated and deliberately not a visual or
 * selector baseline. This only excludes passive assertions on its changing
 * contents; entry/exit controls still go through normal frozen-tree proof. */
export function excludesDynamicContent(
  title: string | undefined,
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>,
): boolean {
  return (
    isDynamicSharedConversations(title) && (step.kind === "expect" || step.kind === "wait-for")
  );
}
