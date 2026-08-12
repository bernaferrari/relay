import type {
  ActionSpec,
  AppMap,
  AppMapCombine,
  AppMapCompiledFlow,
  AppMapTest,
  Connection,
  RecipeStep,
  ScreenVariant,
  StepTarget,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { compileAppMapFlow, compileAppMapTourSetupFlow } from "./app-map-compiler.js";
import type { TourStop } from "./tour.js";

const LANGUAGE_ROW = /language|idioma|sprache|langue|言語|语言|語言/i;
type TourPreludeStep = Extract<RecipeStep, { kind: "tap" | "key" | "swipe" | "scroll" }>;

/** Keep execution guards on map navigation when compiling a reusable tour.
 *
 * A common iOS route is "open the sidebar when its close control is absent".
 * Dropping that condition makes replay toggle an already-open sidebar closed,
 * which is exactly the kind of accidental reverse navigation a tour must not
 * perform. These fields are execution semantics, not presentation metadata.
 */
function preludeMetadata(
  action: Pick<ActionSpec, "optional" | "when">,
  step?: RecipeStep,
): Pick<TourPreludeStep, "optional" | "when"> {
  return {
    ...(action.optional || step?.optional ? { optional: true } : {}),
    ...((step?.when ?? action.when) ? { when: structuredClone(step?.when ?? action.when) } : {}),
  };
}

function recordedOrAuthoredSteps(action: ActionSpec): RecipeStep[] {
  if (action.kind === "recorded" || action.kind === "steps") return action.steps ?? [];
  return [];
}

function recipeGraphFromCompiledFlow(
  map: AppMap,
  plan: AppMapCompiledFlow,
): Record<string, Recipe> {
  return Object.fromEntries(
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

function hasUsableSourceAnchorViewport(
  candidate: ScreenVariant | undefined,
): candidate is ScreenVariant {
  const viewport = candidate?.targetProfile.viewport;
  return Boolean(viewport && viewport.width > 0 && viewport.height > 0);
}

function usableSourceAnchorVariants(map: AppMap, connection: Connection): ScreenVariant[] {
  const source = map.screens[connection.fromScreenId];
  return (source?.variantIds ?? [])
    .map((id) => map.screenVariants[id])
    .filter(hasUsableSourceAnchorViewport);
}

function recordedTapViewport(
  connection: Connection,
): { width: number; height: number } | undefined {
  const viewport = firstTapTarget(connection.actions)?.point?.referenceBounds;
  return viewport && viewport.width > 0 && viewport.height > 0 ? viewport : undefined;
}

function destinationProfileIds(map: AppMap, connection: Connection): Set<string> {
  if (connection.destination.kind !== "screen") return new Set();
  const destination = map.screens[connection.destination.screenId];
  return new Set(
    (destination?.variantIds ?? [])
      .map((id) => map.screenVariants[id]?.targetProfile.id)
      .filter((id): id is string => Boolean(id)),
  );
}

/**
 * Recordings preserve the source interaction in normalized coordinates even
 * when a platform cannot retain a usable accessibility target. Rehydrate that
 * evidence against the source variant's recorded viewport for pixel fallback
 * playback.
 *
 * A ConnectionSourceAnchor intentionally has no mutable presentation state or
 * target-profile ID. In a multi-orientation map, guessing from variant order
 * can turn a legitimate source tap into a wrong pixel tap. Restrict candidates
 * using immutable recording geometry and the destination's matching profile;
 * if those do not identify one viewport, omit the pixel fallback and retain
 * the label/identifier instead. This is intentionally fail-closed.
 */
function sourceAnchorPoint(map: AppMap, connection: Connection): StepTarget["point"] | undefined {
  const anchor = connection.sourceAnchor?.point;
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return undefined;

  let candidates = usableSourceAnchorVariants(map, connection);
  if (!candidates.length) return undefined;

  const recordedViewport = recordedTapViewport(connection);
  if (recordedViewport) {
    const matchingViewport = candidates.filter((candidate) => {
      const viewport = candidate.targetProfile.viewport!;
      return (
        viewport.width === recordedViewport.width && viewport.height === recordedViewport.height
      );
    });
    if (matchingViewport.length) candidates = matchingViewport;
  }

  const destinationProfiles = destinationProfileIds(map, connection);
  if (destinationProfiles.size) {
    const matchingDestination = candidates.filter((candidate) =>
      destinationProfiles.has(candidate.targetProfile.id),
    );
    if (matchingDestination.length) candidates = matchingDestination;
  }

  if (candidates.length !== 1) return undefined;
  const viewport = candidates[0]!.targetProfile.viewport!;
  return {
    x: Math.round(anchor.x * viewport.width),
    y: Math.round(anchor.y * viewport.height),
  };
}

function navigationStepsFromActions(actions: ActionSpec[] | undefined): TourPreludeStep[] {
  const steps: TourPreludeStep[] = [];
  for (const action of actions ?? []) {
    if (action.kind === "tap") {
      steps.push({ kind: "tap", target: action.target, ...preludeMetadata(action) });
      continue;
    }
    if (action.kind === "back") {
      steps.push({ kind: "key", key: "back", ...preludeMetadata(action) });
      continue;
    }
    if (action.kind === "gesture") {
      steps.push(
        action.gesture.kind === "swipe"
          ? {
              kind: "swipe",
              from: { ...action.gesture.from },
              to: { ...action.gesture.to },
              ...preludeMetadata(action),
              ...(action.gesture.durationMs === undefined
                ? {}
                : { durationMs: action.gesture.durationMs }),
            }
          : {
              kind: "scroll",
              direction: action.gesture.direction,
              ...preludeMetadata(action),
              ...(action.gesture.amount === undefined ? {} : { amount: action.gesture.amount }),
            },
      );
      continue;
    }
    for (const step of recordedOrAuthoredSteps(action)) {
      if (step.kind === "tap" && step.target) {
        steps.push({ kind: "tap", target: step.target, ...preludeMetadata(action, step) });
      } else if (step.kind === "key") {
        steps.push({ kind: "key", key: step.key, ...preludeMetadata(action, step) });
      } else if (step.kind === "swipe") {
        steps.push({
          kind: "swipe",
          from: { ...step.from },
          to: { ...step.to },
          ...preludeMetadata(action, step),
          ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
        });
      } else if (step.kind === "scroll") {
        steps.push({
          kind: "scroll",
          direction: step.direction,
          ...preludeMetadata(action, step),
          ...(step.amount === undefined ? {} : { amount: step.amount }),
        });
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
    // Gestures are navigation to a scroll checkpoint, not a row a depth-0
    // tour can press. They remain part of a prelude to that checkpoint.
    const target = firstTapTarget(connection.actions);
    if (!target) continue;
    const point =
      target.point && Number.isFinite(target.point.x) && Number.isFinite(target.point.y)
        ? { x: target.point.x, y: target.point.y }
        : sourceAnchorPoint(map, connection);
    const resolvedTarget = point ? { ...target, point } : target;
    // A screen can expose two rows with the same localized label (for
    // example, a setting and its library picker). Preserve distinct stable
    // targets instead of silently dropping one from coverage.
    const key = tourStopTargetKey(resolvedTarget, label);
    if (seen.has(key)) continue;
    seen.add(key);
    const identifier = target?.identifier?.trim();
    const labelTarget = target?.label?.trim();
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
  const allowedTargetKeys = new Set(
    (Object.values(map.connections ?? {}) as Connection[])
      .filter(
        (connection) =>
          connection.fromScreenId === rootScreenId &&
          connection.destination.kind === "screen" &&
          screenIds.has(connection.destination.screenId),
      )
      .map((connection) => {
        const label = connection.label?.trim();
        const target = firstTapTarget(connection.actions);
        const point = target ? sourceAnchorPoint(map, connection) : undefined;
        const resolvedTarget = target && point && !target.point ? { ...target, point } : target;
        return label && resolvedTarget ? tourStopTargetKey(resolvedTarget, label) : undefined;
      })
      .filter((key): key is string => Boolean(key)),
  );
  return fallbackTourStopsFromMap(map, rootScreenId, captureScreenIds).filter((stop) =>
    allowedTargetKeys.has(tourStopTargetKey(stop, stop.label)),
  );
}

function tourStopTargetKey(
  target: Pick<StepTarget, "identifier" | "label" | "point">,
  fallbackLabel: string,
): string {
  if (target.identifier?.trim())
    return `identifier:${target.identifier.trim().toLocaleLowerCase()}`;
  if (target.point) return `point:${Math.round(target.point.x)}:${Math.round(target.point.y)}`;
  return `label:${(target.label ?? fallbackLabel).toLocaleLowerCase()}`;
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
    const graph = recipeGraphFromCompiledFlow(map, plan);
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
  const setupFlowId = work.setupFlowId?.trim();
  const setupPlan = setupFlowId
    ? compileAppMapTourSetupFlow(map, setupFlowId, work.rootScreenId)
    : undefined;
  const fingerprint = screen?.identity?.fingerprint?.trim();
  const aliases = screen?.identity?.aliases?.filter((alias) => alias.trim()) ?? [];
  const exactScreenIds = work.screenIds?.length ? new Set(work.screenIds) : undefined;
  const evidenceMode = captureMode(work);
  const checkpointIds =
    work.capture?.mode === "checkpoints" ? new Set(work.capture.screenIds) : undefined;
  const shouldCaptureScreen = (screenId: string) =>
    evidenceMode === "every-screen" || checkpointIds?.has(screenId) === true;
  // An explicit setup Flow is the authoritative cold start. Do not append the
  // map's inferred reverse path afterward: that would replay Home → Menu →
  // Settings twice and can toggle a sidebar back closed.
  const preludeConnections = setupPlan ? [] : preludeConnectionsToScreen(map, work.rootScreenId);
  const preludeStartScreen = preludeConnections[0]
    ? map.screens[preludeConnections[0].fromScreenId]
    : undefined;
  const preludeStartFingerprint = preludeStartScreen?.identity?.fingerprint?.trim();
  const preludeStartAliases =
    preludeStartScreen?.identity?.aliases?.filter((alias) => alias.trim()) ?? [];
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
      (screenId) =>
        screenId !== work.rootScreenId &&
        !preludeScreenIds.has(screenId) &&
        !childScreenIds.has(screenId),
    );
    if (unsupported.length) {
      throw new Error(
        `Test “${work.name}” cannot reach selected screen(s): ${unsupported
          .map((id) => map.screens[id]?.title ?? id)
          .join(", ")}`,
      );
    }
  }
  const prelude = preludeConnections.flatMap((connection) =>
    navigationStepsFromActions(connection.actions),
  );
  // Exact tests that only care about their root and children must recover to
  // the prelude's start surface before replaying it. Keep the legacy inline
  // sequence only when callers explicitly requested evidence for intermediate
  // prelude screens too.
  const preludeEvidenceRequested = Boolean(
    exactScreenIds &&
    [...preludeScreenIds].some(
      (screenId) => screenId !== work.rootScreenId && exactScreenIds.has(screenId),
    ),
  );
  const runPreludeInTour = Boolean(exactScreenIds && prelude.length && !preludeEvidenceRequested);
  const captureOrigin = Boolean(
    exactScreenIds?.has(work.rootScreenId) &&
    shouldCaptureScreen(work.rootScreenId) &&
    (runPreludeInTour || !preludeConnections.length),
  );
  const steps: RecipeStep[] = [];
  if (setupPlan) steps.push({ kind: "module", recipeId: setupPlan.rootRecipeId });
  if (exactScreenIds && !runPreludeInTour) {
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
      !captureOrigin &&
      exactScreenIds.has(work.rootScreenId) &&
      shouldCaptureScreen(work.rootScreenId)
    ) {
      steps.push({
        kind: "screenshot",
        caption: `screen:${map.screens[work.rootScreenId]?.title ?? work.rootScreenId}`,
      });
    }
  }
  if (!exactScreenIds || fallbackStops.length || captureOrigin || runPreludeInTour) {
    steps.push({
      kind: "tour",
      depth,
      screenshot: evidenceMode === "every-screen" || evidenceMode === "checkpoints",
      excludeLanguageRows: true,
      originScreenId: work.rootScreenId,
      originTitle: screen?.title ?? work.name,
      ...(fingerprint ? { originFingerprint: fingerprint } : {}),
      ...(aliases.length ? { originAliases: aliases } : {}),
      ...(prelude.length && (!exactScreenIds || runPreludeInTour) ? { preludeSteps: prelude } : {}),
      ...(prelude.length && preludeStartFingerprint ? { preludeStartFingerprint } : {}),
      ...(prelude.length && preludeStartAliases.length ? { preludeStartAliases } : {}),
      ...(captureOrigin ? { captureOrigin: true } : {}),
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
  return {
    root,
    graph: {
      ...(setupPlan ? recipeGraphFromCompiledFlow(map, setupPlan) : {}),
      [root.id]: root,
    },
  };
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
