import type {
  ActionSpec,
  AppMap,
  AppMapCombine,
  AppMapTest,
  Connection,
  RecipeStep,
  StepTarget,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { compileAppMapFlow } from "./app-map-compiler.js";
import type { TourStop } from "./tour.js";

const LANGUAGE_ROW = /language|idioma|sprache|langue|言語|语言|語言/i;

function recordedOrAuthoredSteps(action: ActionSpec): RecipeStep[] {
  if (action.kind === "recorded" || action.kind === "steps") return action.steps ?? [];
  return [];
}

function tapTargetFromStep(step: RecipeStep): StepTarget | undefined {
  if (step.kind !== "tap" || !step.target) return undefined;
  return step.target;
}

function firstTapTarget(actions: ActionSpec[] | undefined): StepTarget | undefined {
  for (const action of actions ?? []) {
    if (action.kind === "tap") return action.target;
    for (const step of recordedOrAuthoredSteps(action)) {
      const target = tapTargetFromStep(step);
      if (target) return target;
    }
  }
  return undefined;
}

function navigationStepsFromActions(actions: ActionSpec[] | undefined): RecipeStep[] {
  const steps: RecipeStep[] = [];
  for (const action of actions ?? []) {
    if (action.kind === "tap") {
      steps.push({ kind: "tap", target: action.target });
      continue;
    }
    if (action.kind === "back") {
      steps.push({ kind: "key", key: "back" });
      continue;
    }
    for (const step of recordedOrAuthoredSteps(action)) {
      if (step.kind === "tap" && step.target) {
        steps.push({ kind: "tap", target: step.target });
      } else if (step.kind === "key") {
        steps.push({ kind: "key", key: step.key });
      }
    }
  }
  return steps;
}

export function fallbackTourStopsFromMap(map: AppMap, rootScreenId: string): TourStop[] {
  const stops: TourStop[] = [];
  const seen = new Set<string>();
  for (const connection of Object.values(map.connections ?? {}) as Connection[]) {
    if (connection.fromScreenId !== rootScreenId) continue;
    const label = connection.label?.trim();
    if (!label || LANGUAGE_ROW.test(label)) continue;
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const target = firstTapTarget(connection.actions);
    const identifier = target?.identifier?.trim();
    const labelTarget = target?.label?.trim();
    const point =
      target?.point && Number.isFinite(target.point.x) && Number.isFinite(target.point.y)
        ? { x: target.point.x, y: target.point.y }
        : undefined;
    stops.push({
      label: labelTarget || label,
      ...(identifier ? { identifier } : {}),
      ...(point ? { point } : {}),
    });
  }
  return stops;
}

/** Walk mapped In-paths so a tour can start from Ask/Imagine, not only Settings. */
export function preludeStepsToScreen(map: AppMap, rootScreenId: string): RecipeStep[] {
  const connections = Object.values(map.connections ?? {}) as Connection[];
  const incoming = new Map<string, Connection[]>();
  const destinations = new Set<string>();
  for (const connection of connections) {
    if (connection.destination.kind !== "screen") continue;
    const to = connection.destination.screenId;
    destinations.add(to);
    const list = incoming.get(to) ?? [];
    list.push(connection);
    incoming.set(to, list);
  }
  const startIds = new Set(
    Object.values(map.flows ?? {})
      .map((flow) => flow.startScreenId)
      .filter((id): id is string => Boolean(id?.trim())),
  );
  if (!startIds.size) {
    for (const id of Object.keys(map.screens ?? {})) {
      if (!destinations.has(id)) startIds.add(id);
    }
  }
  if (startIds.has(rootScreenId) || startIds.size === 0) return [];

  type Hop = { screenId: string; path: Connection[] };
  const queue: Hop[] = [{ screenId: rootScreenId, path: [] }];
  const seen = new Set<string>([rootScreenId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const connection of incoming.get(current.screenId) ?? []) {
      const from = connection.fromScreenId;
      if (seen.has(from)) continue;
      const nextPath = [connection, ...current.path];
      if (startIds.has(from)) {
        return nextPath.flatMap((item) => navigationStepsFromActions(item.actions));
      }
      seen.add(from);
      queue.push({ screenId: from, path: nextPath });
    }
  }
  return [];
}

export function compileAppMapTest(
  map: AppMap,
  work: AppMapTest,
): { root: Recipe; graph: Record<string, Recipe> } {
  if (work.kind === "path") {
    const flowId = work.flowId?.trim();
    if (!flowId || !map.flows[flowId]) throw new Error(`Test “${work.name}” is missing its path`);
    const plan = compileAppMapFlow(map, flowId);
    const graph = Object.fromEntries(
      Object.values(plan.recipes).map((compiled) => [
        compiled.id,
        {
          id: compiled.id,
          title: compiled.title,
          ...(compiled.description ? { description: compiled.description } : {}),
          source: "custom" as const,
          steps: compiled.steps,
          createdAt: map.createdAt,
          updatedAt: map.updatedAt,
        },
      ]),
    );
    const root = graph[plan.rootRecipeId];
    if (!root) throw new Error(`Test “${work.name}” compiled without a root recipe`);
    return { root, graph };
  }
  if (!work.rootScreenId?.trim() || !map.screens[work.rootScreenId]) {
    throw new Error(`Test “${work.name}” needs a root screen`);
  }
  const depth = work.depth ?? 0;
  const screen = map.screens[work.rootScreenId];
  const fingerprint = screen?.identity?.fingerprint?.trim();
  const aliases = screen?.identity?.aliases?.filter((alias) => alias.trim()) ?? [];
  const fallbackStops = fallbackTourStopsFromMap(map, work.rootScreenId);
  const prelude = preludeStepsToScreen(map, work.rootScreenId).flatMap((step) =>
    step.kind === "tap" || step.kind === "key" ? [step] : [],
  );
  const steps: RecipeStep[] = [
    {
      kind: "tour",
      depth,
      screenshot: work.screenshotEach !== false,
      excludeLanguageRows: true,
      originScreenId: work.rootScreenId,
      originTitle: screen?.title ?? work.name,
      ...(fingerprint ? { originFingerprint: fingerprint } : {}),
      ...(aliases.length ? { originAliases: aliases } : {}),
      ...(prelude.length ? { preludeSteps: prelude } : {}),
      ...(fallbackStops.length ? { fallbackStops } : {}),
    },
  ];
  const root: Recipe = {
    id: `test-${work.id}`,
    title: work.name,
    description: `Tour ${map.screens[work.rootScreenId]?.title ?? work.rootScreenId} depth ${depth}`,
    source: "custom",
    steps,
    createdAt: map.updatedAt,
    updatedAt: map.updatedAt,
  };
  return { root, graph: { [root.id]: root } };
}

export function compileAppMapCombine(
  map: AppMap,
  combine: AppMapCombine,
): { root: Recipe; graph: Record<string, Recipe> } {
  if (!combine.testIds.length) throw new Error("Combination needs at least one test");
  const graph: Record<string, Recipe> = {};
  const modules: RecipeStep[] = [];
  for (const testId of combine.testIds) {
    const work = map.tests?.[testId];
    if (!work) throw new Error(`Test ${testId} is missing`);
    const compiled = compileAppMapTest(map, work);
    Object.assign(graph, compiled.graph);
    modules.push({ kind: "module", recipeId: compiled.root.id });
  }
  if (modules.length === 1) {
    const only = modules[0];
    if (only?.kind === "module") {
      const root = graph[only.recipeId];
      if (root) return { root, graph };
    }
  }
  const root: Recipe = {
    id: `combine-${combine.id}`,
    title: combine.name,
    source: "custom",
    steps: modules,
    createdAt: map.updatedAt,
    updatedAt: map.updatedAt,
  };
  graph[root.id] = root;
  return { root, graph };
}
