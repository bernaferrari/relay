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

export function fallbackTourStopsFromMap(
  map: AppMap,
  rootScreenId: string,
  captureScreenIds?: ReadonlySet<string>,
): TourStop[] {
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
      ...(captureScreenIds && connection.destination.kind === "screen"
        ? { capture: captureScreenIds.has(connection.destination.screenId) }
        : {}),
    });
  }
  return stops;
}

function fallbackTourStopsForScreens(
  map: AppMap,
  rootScreenId: string,
  screenIds: Set<string>,
  captureScreenIds?: ReadonlySet<string>,
): TourStop[] {
  const allowedLabels = new Set(
    (Object.values(map.connections ?? {}) as Connection[])
      .filter(
        (connection) =>
          connection.fromScreenId === rootScreenId &&
          connection.destination.kind === "screen" &&
          screenIds.has(connection.destination.screenId),
      )
      .map((connection) => connection.label?.trim().toLocaleLowerCase())
      .filter((label): label is string => Boolean(label)),
  );
  return fallbackTourStopsFromMap(map, rootScreenId, captureScreenIds).filter((stop) =>
    allowedLabels.has(stop.label.trim().toLocaleLowerCase()),
  );
}

function captureMode(work: AppMapTest): NonNullable<AppMapTest["capture"]>["mode"] {
  return work.capture?.mode ?? (work.screenshotEach === false ? "none" : "every-screen");
}

function preludeConnectionsToScreen(map: AppMap, rootScreenId: string): Connection[] {
  const connections = Object.values(map.connections ?? {}) as Connection[];
  const incoming = new Map<string, Connection[]>();
  const destinations = new Set<string>();
  for (const connection of connections) {
    if (connection.destination.kind !== "screen") continue;
    const to = connection.destination.screenId;
    destinations.add(to);
    incoming.set(to, [...(incoming.get(to) ?? []), connection]);
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
      if (startIds.has(from)) return nextPath;
      seen.add(from);
      queue.push({ screenId: from, path: nextPath });
    }
  }
  return [];
}

/** Walk mapped In-paths so a tour can start from Ask/Imagine, not only Settings. */
export function preludeStepsToScreen(map: AppMap, rootScreenId: string): RecipeStep[] {
  return preludeConnectionsToScreen(map, rootScreenId).flatMap((item) =>
    navigationStepsFromActions(item.actions),
  );
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
    let root = graph[plan.rootRecipeId];
    if (!root) throw new Error(`Test “${work.name}” compiled without a root recipe`);
    const evidenceMode = captureMode(work);
    if (evidenceMode !== "every-screen") {
      for (const [id, recipe] of Object.entries(graph)) {
        graph[id] = {
          ...recipe,
          steps: recipe.steps.filter((step) => step.kind !== "screenshot"),
        };
      }
      root = graph[plan.rootRecipeId]!;
    }
    if (evidenceMode === "final-screen") {
      root = {
        ...root,
        steps: [...root.steps, { kind: "screenshot", caption: `final:${work.name}` }],
      };
      graph[root.id] = root;
    }
    return { root, graph };
  }
  if (!work.rootScreenId?.trim() || !map.screens[work.rootScreenId]) {
    throw new Error(`Test “${work.name}” needs a root screen`);
  }
  const depth = work.depth ?? 0;
  const screen = map.screens[work.rootScreenId];
  const fingerprint = screen?.identity?.fingerprint?.trim();
  const aliases = screen?.identity?.aliases?.filter((alias) => alias.trim()) ?? [];
  const exactScreenIds = work.screenIds?.length ? new Set(work.screenIds) : undefined;
  const evidenceMode = captureMode(work);
  const checkpointIds =
    work.capture?.mode === "checkpoints" ? new Set(work.capture.screenIds) : undefined;
  const shouldCaptureScreen = (screenId: string) =>
    evidenceMode === "every-screen" || checkpointIds?.has(screenId) === true;
  const preludeConnections = preludeConnectionsToScreen(map, work.rootScreenId);
  const preludeScreenIds = new Set<string>();
  if (preludeConnections[0]) preludeScreenIds.add(preludeConnections[0].fromScreenId);
  for (const connection of preludeConnections) {
    if (connection.destination.kind === "screen") {
      preludeScreenIds.add(connection.destination.screenId);
    }
  }
  const fallbackStops = exactScreenIds
    ? fallbackTourStopsForScreens(map, work.rootScreenId, exactScreenIds, checkpointIds)
    : fallbackTourStopsFromMap(map, work.rootScreenId, checkpointIds);
  const childScreenIds = new Set(
    (Object.values(map.connections ?? {}) as Connection[])
      .filter(
        (connection) =>
          connection.fromScreenId === work.rootScreenId && connection.destination.kind === "screen",
      )
      .map((connection) =>
        connection.destination.kind === "screen" ? connection.destination.screenId : "",
      ),
  );
  if (exactScreenIds) {
    const unsupported = [...exactScreenIds].filter(
      (screenId) => !preludeScreenIds.has(screenId) && !childScreenIds.has(screenId),
    );
    if (unsupported.length) {
      throw new Error(
        `Test “${work.name}” cannot reach selected screen(s): ${unsupported
          .map((id) => map.screens[id]?.title ?? id)
          .join(", ")}`,
      );
    }
  }
  const prelude = preludeConnections
    .flatMap((connection) => navigationStepsFromActions(connection.actions))
    .flatMap((step) => (step.kind === "tap" || step.kind === "key" ? [step] : []));
  const steps: RecipeStep[] = [];
  if (exactScreenIds) {
    const first = preludeConnections[0]?.fromScreenId;
    if (first && exactScreenIds.has(first) && shouldCaptureScreen(first)) {
      steps.push({ kind: "screenshot", caption: `screen:${map.screens[first]?.title ?? first}` });
    }
    for (const connection of preludeConnections) {
      steps.push(...navigationStepsFromActions(connection.actions));
      steps.push({ kind: "sleep", ms: 350 });
      if (
        connection.destination.kind === "screen" &&
        exactScreenIds.has(connection.destination.screenId) &&
        shouldCaptureScreen(connection.destination.screenId)
      ) {
        const destinationId = connection.destination.screenId;
        steps.push({
          kind: "screenshot",
          caption: `screen:${map.screens[destinationId]?.title ?? destinationId}`,
        });
      }
    }
    if (
      !preludeConnections.length &&
      exactScreenIds.has(work.rootScreenId) &&
      shouldCaptureScreen(work.rootScreenId)
    ) {
      steps.push({
        kind: "screenshot",
        caption: `screen:${map.screens[work.rootScreenId]?.title ?? work.rootScreenId}`,
      });
    }
  }
  if (!exactScreenIds || fallbackStops.length) {
    steps.push({
      kind: "tour",
      depth,
      screenshot: evidenceMode === "every-screen" || evidenceMode === "checkpoints",
      excludeLanguageRows: true,
      originScreenId: work.rootScreenId,
      originTitle: screen?.title ?? work.name,
      ...(fingerprint ? { originFingerprint: fingerprint } : {}),
      ...(aliases.length ? { originAliases: aliases } : {}),
      ...(!exactScreenIds && prelude.length ? { preludeSteps: prelude } : {}),
      ...(fallbackStops.length ? { fallbackStops } : {}),
      ...(exactScreenIds ? { mappedStopsOnly: true } : {}),
    });
  }
  if (evidenceMode === "final-screen") {
    steps.push({ kind: "screenshot", caption: `final:${work.name}` });
  }
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
    const compiled = compileAppMapTest(map, {
      ...work,
      ...(combine.captures?.[testId] ? { capture: combine.captures[testId] } : {}),
    });
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
