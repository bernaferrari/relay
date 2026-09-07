/** Fields every node inherits unless it writes an override. */
export const accessibilityNodeDefaults = {
  enabled: true,
  visible: true,
} as const;

const systemUiBundle = /^(com\.android\.systemui|com\.apple\.springboard)$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function shortType(type: unknown): unknown {
  return typeof type === "string" ? type.replace(/^android\.(widget|view)\./u, "") : type;
}

function nodeApp(node: Record<string, unknown>): string | undefined {
  for (const key of ["bundleId", "app", "packageName"] as const) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Foreground app, then the most common non-chrome bundle on the tree. */
export function inferAccessibilityApp(
  snapshot: Record<string, unknown>,
  nodes: readonly Record<string, unknown>[],
): string | undefined {
  for (const key of ["treeApp", "foregroundApp", "app"] as const) {
    const value = snapshot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const app = nodeApp(node);
    if (!app || systemUiBundle.test(app)) continue;
    counts.set(app, (counts.get(app) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [app, count] of counts) {
    if (count > bestCount) {
      best = app;
      bestCount = count;
    }
  }
  return best;
}

export function presentAccessibilityNode(
  node: unknown,
  defaults: { app?: string; enabled: boolean; visible: boolean },
): Record<string, unknown> {
  const source = record(node) ?? {};
  const out: Record<string, unknown> = {};
  if (source.type) out.type = shortType(source.type);
  if (typeof source.label === "string" && source.label) out.label = source.label;
  if (typeof source.description === "string" && source.description) {
    out.description = source.description;
  }
  if (typeof source.value === "string" && source.value && source.value !== source.label) {
    out.value = source.value;
  }
  if (typeof source.identifier === "string" && source.identifier)
    out.identifier = source.identifier;
  const app = nodeApp(source);
  if (app && app !== defaults.app) out.app = app;
  if (source.rect) out.rect = source.rect;
  if (source.enabled === false && defaults.enabled) out.enabled = false;
  if (source.visibleToUser === false && defaults.visible) out.visible = false;
  if (source.visible === false && defaults.visible) out.visible = false;
  if (source.hittable === true) out.hittable = true;
  if (source.hittable === false) out.hittable = false;
  if (source.hiddenContentBelow === true || source.hiddenContentBelow === false) {
    out.hiddenContentBelow = source.hiddenContentBelow;
  }
  if (typeof source.depth === "number") out.depth = source.depth;
  return out;
}

export type PresentedAccessibilitySnapshot = {
  defaults: { app?: string; enabled: true; visible: true };
  nodes: Record<string, unknown>[];
  capturedAt?: unknown;
  bounds?: unknown;
  inspectable?: unknown;
};

/** Persistable tree: defaults once, nodes only write overrides. */
export function presentPersistedSnapshot(snapshot: unknown): PresentedAccessibilitySnapshot {
  const body = record(snapshot) ?? {};
  const rawNodes = Array.isArray(body.nodes) ? body.nodes : [];
  const nodeRecords = rawNodes.flatMap((node) => {
    const item = record(node);
    return item ? [item] : [];
  });
  const app = inferAccessibilityApp(body, nodeRecords);
  const defaults = {
    ...(app ? { app } : {}),
    enabled: true as const,
    visible: true as const,
  };
  return {
    defaults,
    ...(body.capturedAt !== undefined ? { capturedAt: body.capturedAt } : {}),
    ...(body.bounds !== undefined ? { bounds: body.bounds } : {}),
    ...(body.inspectable !== undefined ? { inspectable: body.inspectable } : {}),
    nodes: nodeRecords.map((node) => presentAccessibilityNode(node, defaults)),
  };
}
