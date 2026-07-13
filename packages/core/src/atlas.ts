import { createHash } from "node:crypto";
import type { Recipe, RecipeStep } from "./recipes.js";

export type AtlasNode = {
  id: string;
  title: string;
  stepCount: number;
  capabilities: string[];
  signature: string;
};

export type AtlasEdge = {
  from: string;
  to: string;
  kind: "reuse" | "branch" | "repeat";
  label: string;
};

export type AtlasDuplicateCluster = {
  signature: string;
  recipeIds: string[];
  savings: number;
};

export type TestAtlas = {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  duplicateClusters: AtlasDuplicateCluster[];
  coverage: Array<{ capability: string; tests: number }>;
};

const capabilityFor: Partial<Record<RecipeStep["kind"], string>> = {
  tap: "Interaction",
  type: "Text input",
  clipboard: "Clipboard",
  app: "App lifecycle",
  device: "Lock screen & keyboard",
  rotate: "Rotation",
  permission: "Permissions",
  location: "Location",
  network: "Network evidence",
  logs: "Device logs",
  extract: "Response extraction",
  "assert-content": "Deterministic assertions",
  "evaluate-semantic": "AI evaluation",
  "wait-response": "Streaming completion",
  branch: "Branching",
  repeat: "Loops",
  script: "Data transforms",
};

function signatureFor(steps: RecipeStep[]): string {
  const normalized = steps.map((step) => {
    const value = structuredClone(step) as Record<string, unknown>;
    delete value.note;
    delete value.evidence;
    if (typeof value.text === "string")
      value.text = value.text.replace(/\{\{.*?\}\}/g, "{{value}}");
    return value;
  });
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 12);
}

export function buildTestAtlas(recipes: Recipe[]): TestAtlas {
  const executable = recipes.filter((recipe) => recipe.steps.length > 0);
  const nodes = executable.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    stepCount: recipe.steps.length,
    capabilities: [
      ...new Set(
        recipe.steps.flatMap((step) =>
          capabilityFor[step.kind] ? [capabilityFor[step.kind]!] : [],
        ),
      ),
    ].sort(),
    signature: signatureFor(recipe.steps),
  }));
  const known = new Set(nodes.map((node) => node.id));
  const edges: AtlasEdge[] = executable.flatMap((recipe) =>
    recipe.steps.flatMap((step) => {
      const links =
        step.kind === "module"
          ? [{ to: step.recipeId, kind: "reuse" as const, label: "Reuses" }]
          : step.kind === "repeat"
            ? [{ to: step.recipeId, kind: "repeat" as const, label: `Repeats ${step.count}×` }]
            : step.kind === "branch"
              ? [
                  { to: step.thenRecipeId, kind: "branch" as const, label: "Matched" },
                  ...(step.elseRecipeId
                    ? [{ to: step.elseRecipeId, kind: "branch" as const, label: "Otherwise" }]
                    : []),
                ]
              : [];
      return links
        .filter((link) => known.has(link.to))
        .map((link) => ({ from: recipe.id, ...link }));
    }),
  );
  const bySignature = new Map<string, string[]>();
  for (const node of nodes) {
    const group = bySignature.get(node.signature) ?? [];
    group.push(node.id);
    bySignature.set(node.signature, group);
  }
  const duplicateClusters = [...bySignature.entries()]
    .filter(([, recipeIds]) => recipeIds.length > 1)
    .map(([signature, recipeIds]) => ({ signature, recipeIds, savings: recipeIds.length - 1 }));
  const coverageCounts = new Map<string, number>();
  for (const node of nodes) {
    for (const capability of node.capabilities) {
      coverageCounts.set(capability, (coverageCounts.get(capability) ?? 0) + 1);
    }
  }
  const coverage = [...coverageCounts.entries()]
    .map(([capability, tests]) => ({ capability, tests }))
    .sort((a, b) => b.tests - a.tests || a.capability.localeCompare(b.capability));
  return { nodes, edges, duplicateClusters, coverage };
}
