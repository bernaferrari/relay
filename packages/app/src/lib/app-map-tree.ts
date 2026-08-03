import type { RecipeStep } from "./api-types";

export type MapTreeNode = {
  id: string;
  screenKey: string;
  title: string;
  representativeStepIndex: number;
  stepIndexes: number[];
  depth: number;
  x: number;
  y: number;
};

export type MapTreeEdge = {
  id: string;
  from: string;
  to: string;
  stepIndex: number;
  label: string;
  kind: "forward" | "return";
};

export type MapTree = {
  nodes: MapTreeNode[];
  edges: MapTreeEdge[];
  /**
   * A real screen map needs a durable visual hash or a captured UI tree. The
   * step-index fallback keeps the model total, but must never be presented as
   * a meaningful map without durable screen evidence.
   */
  hasScreenIdentity: boolean;
};

type DraftNode = Omit<MapTreeNode, "depth" | "x" | "y"> & {
  parentId?: string;
  childIds: string[];
};

/**
 * A screen is identified by durable recording evidence, never by the step's
 * position in a list. Exact screenshot hashes are preferred; an ordered UI
 * tree signature lets older recordings still fold repeated screens together.
 */
export function screenKeyForStep(step: RecipeStep, index: number): string {
  const evidence = step.evidence;
  const screenshot = evidence?.screenshot;
  if (screenshot?.sha256) return `image:${screenshot.sha256}`;

  const nodes = evidence?.nodes;
  if (nodes?.length) {
    const semantic = nodes
      .slice(0, 80)
      .map((node) =>
        [
          node.role ?? node.type ?? "",
          node.label ?? "",
          node.value ?? "",
          node.identifier ?? "",
        ].join("\u0001"),
      )
      .sort()
      .join("\u0002");
    if (semantic) return `tree:${stableHash(semantic)}`;
  }

  // Older evidence can still show a useful ordered path; it just cannot claim
  // that two separate captures are the same screen.
  return `step:${index}`;
}

export function hasScreenIdentity(step: RecipeStep): boolean {
  return Boolean(step.evidence?.screenshot?.sha256 || step.evidence?.nodes?.length);
}

export function buildMapTree(steps: RecipeStep[]): MapTree {
  const nodes = new Map<string, DraftNode>();
  const screenIds: string[] = [];
  const edges: MapTreeEdge[] = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    const screenKey = screenKeyForStep(step, index);
    const id = `screen:${screenKey}`;
    const wasKnown = nodes.has(id);
    const previousId = screenIds[index - 1];

    if (!wasKnown) {
      const parent = previousId ? nodes.get(previousId) : undefined;
      nodes.set(id, {
        id,
        screenKey,
        title: index === 0 ? "Start" : screenTitleFromArrival(steps[index - 1]!, index + 1),
        representativeStepIndex: index,
        stepIndexes: [index],
        ...(parent ? { parentId: parent.id } : {}),
        childIds: [],
      });
      if (parent) parent.childIds.push(id);
    } else {
      nodes.get(id)!.stepIndexes.push(index);
    }

    screenIds.push(id);
    if (!previousId || previousId === id) continue;

    edges.push({
      id: `${previousId}→${id}:${index - 1}`,
      from: previousId,
      to: id,
      stepIndex: index - 1,
      label: transitionLabel(steps[index - 1]!),
      kind: wasKnown ? "return" : "forward",
    });
  }

  const rootIds = [...nodes.values()].filter((node) => !node.parentId).map((node) => node.id);
  let leaf = 0;
  const laidOut = new Map<string, MapTreeNode>();
  const place = (id: string, depth: number): number => {
    const node = nodes.get(id)!;
    const childYs = node.childIds.map((child) => place(child, depth + 1));
    const y = childYs.length
      ? childYs.reduce((sum, value) => sum + value, 0) / childYs.length
      : leaf++ * 400;
    laidOut.set(id, { ...node, depth, x: depth * 304, y });
    return y;
  };
  for (const root of rootIds) place(root, 0);

  const positioned = [...laidOut.values()].sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    return left.y - right.y;
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));
  return {
    nodes: positioned,
    edges: edges.map((edge) => {
      const from = byId.get(edge.from)!;
      const to = byId.get(edge.to)!;
      return {
        ...edge,
        kind: edge.kind === "return" || to.depth <= from.depth ? "return" : "forward",
      };
    }),
    hasScreenIdentity: steps.some(hasScreenIdentity),
  };
}

function screenTitleFromArrival(step: RecipeStep, screenNumber: number): string {
  if (step.kind === "tap") {
    const target = step.target.label ?? step.target.text ?? step.target.ref;
    if (target) return target.replace(/^@/, "");
  }
  if (step.kind === "key" && /back/i.test(step.key)) return "Previous screen";
  return `Screen ${screenNumber}`;
}

export function transitionLabel(step: RecipeStep): string {
  if (step.kind === "tap") {
    const target = step.target.label ?? step.target.text ?? step.target.ref;
    return target ? `Open ${target.replace(/^@/, "")}` : "Tap";
  }
  if (step.kind === "key") return /back/i.test(step.key) ? "Back" : step.key;
  if (step.kind === "swipe") return "Swipe";
  if (step.kind === "scroll") return "Scroll";
  if (step.kind === "type") return "Type";
  return "Continue";
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
