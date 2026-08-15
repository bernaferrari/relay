import type {
  ActionSpec,
  AppMap,
  AppMapCombine,
  AppMapCompiledFlow,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapTest,
  Connection,
  RecipeStep,
  ScreenVariant,
  StepTarget,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { compileAppMapFlow, compileAppMapTourSetupFlow } from "./app-map-compiler.js";
import { compileAppMapScenarioTest } from "./app-map-test-compiler.js";
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

/**
 * A combined matrix launches once, then reuses the app process for each
 * subsequent mapped path. Preserve the recorded setup/navigation steps, but
 * make its launch warm and let only its generated source assertion climb back
 * through the app hierarchy first. Destination assertions remain strict.
 */
/**
 * A tour setup Flow is a cold-start route to the tour's root. Once a combined
 * run has already opened the app, replaying that whole route is actively
 * harmful: its source assertion is usually Home, so recovery backs out of the
 * current Settings branch only to walk straight back into it.
 *
 * The warm form therefore retains the Flow's terminal screen assertion and
 * makes that the recovery target. From any descendant, Back reaches the
 * nearest shared ancestor (the tour root) without visiting Home or replaying
 * menu navigation. The cold Flow remains authoritative for the first test in
 * a world and whenever a tour is run on its own.
 */
function warmCompiledFlowGraphFromSharedPrefix(
  graph: Record<string, Recipe>,
  plan: AppMapCompiledFlow,
  previousPlan?: AppMapCompiledFlow,
): Record<string, Recipe> {
  const root = graph[plan.rootRecipeId];
  if (!root) return graph;
  const sharesStart = previousPlan?.flow.startScreenId === plan.flow.startScreenId;
  let sharedConnectionCount = 0;
  if (sharesStart) {
    while (
      sharedConnectionCount < plan.connections.length &&
      sharedConnectionCount < (previousPlan?.connections.length ?? 0) &&
      plan.connections[sharedConnectionCount]?.connectionId ===
        previousPlan?.connections[sharedConnectionCount]?.connectionId
    ) {
      sharedConnectionCount += 1;
    }
  }

  const sharedConnection = plan.connections[sharedConnectionCount - 1];
  const sharedScreenId =
    sharedConnectionCount === 0
      ? plan.flow.startScreenId
      : sharedConnection?.destination.kind === "screen"
        ? sharedConnection.destination.screenId
        : undefined;
  const sourceIndex = root.steps.findIndex(
    (step) => step.kind === "expect-screen" && step.id === `relay-source-${plan.flow.id}`,
  );
  const suffixStart =
    sharedConnectionCount === 0 ? sourceIndex + 1 : sharedConnection?.compiledStepRange[1];
  const terminalExpectation =
    sharedScreenId && suffixStart !== undefined && suffixStart > 0
      ? root?.steps
          .slice(0, suffixStart)
          .reverse()
          .find(
            (step): step is Extract<RecipeStep, { kind: "expect-screen" }> =>
              step.kind === "expect-screen" && step.screenId === sharedScreenId,
          )
      : undefined;

  // A malformed/legacy setup plan should keep the safe existing behavior,
  // rather than manufacture an unverifiable recovery target.
  if (sourceIndex < 0 || !terminalExpectation) return graph;

  return {
    ...graph,
    [plan.rootRecipeId]: {
      ...root,
      title: root.title.replace(/cold start/iu, "warm recovery"),
      steps: [
        {
          ...structuredClone(terminalExpectation),
          id: `${terminalExpectation.id ?? `relay-source-${sharedScreenId}`}:warm`,
          recovery: { strategy: "back", maxAttempts: 8, restoreParentViewport: true },
        },
        ...root.steps.slice(suffixStart),
      ],
    },
  };
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
  const orderedStops: Array<{ stop: TourStop; sourceOrder?: number }> = [];
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
    const sourceRect = connection.sourceAnchor?.rect;
    const sourceOrder = sourceRect
      ? sourceRect.y + sourceRect.height / 2
      : connection.sourceAnchor?.point?.y;
    orderedStops.push({
      stop: {
        label: labelTarget || label,
        ...(identifier ? { identifier } : {}),
        ...(point ? { point } : {}),
        ...(captureScreenIds && connection.destination.kind === "screen"
          ? { capture: captureScreenIds.has(connection.destination.screenId) }
          : {}),
      },
      ...(Number.isFinite(sourceOrder) ? { sourceOrder } : {}),
    });
  }
  // A recorded action sequence is often created in exploration order rather
  // than the order controls appear on screen. When every selected row has an
  // approved point, its Y position is a stronger, user-visible order for a
  // depth-0 tour and for the canvas fan-out. Preserve the authored order when
  // even one row has no point rather than fabricating an ordering signal.
  if (orderedStops.every((item) => item.sourceOrder !== undefined)) {
    orderedStops.sort(
      (left, right) =>
        left.sourceOrder! - right.sourceOrder! || left.stop.label.localeCompare(right.stop.label),
    );
  } else if (orderedStops.every((item) => Boolean(item.stop.point))) {
    orderedStops.sort(
      (left, right) =>
        left.stop.point!.y - right.stop.point!.y ||
        left.stop.point!.x - right.stop.point!.x ||
        left.stop.label.localeCompare(right.stop.label),
    );
  }
  return orderedStops.map((item) => item.stop);
}

function fallbackTourStopsForScreens(
  map: AppMap,
  rootScreenId: string,
  screenIds: Set<string>,
  captureScreenIds?: ReadonlySet<string>,
  optionalScreenIds?: ReadonlySet<string>,
): TourStop[] {
  const targets = (Object.values(map.connections ?? {}) as Connection[])
    .filter(
      (connection) =>
        connection.fromScreenId === rootScreenId &&
        connection.destination.kind === "screen" &&
        screenIds.has(connection.destination.screenId),
    )
    .map((connection) => {
      const destination = connection.destination;
      if (destination.kind !== "screen") return undefined;
      const label = connection.label?.trim();
      const target = firstTapTarget(connection.actions);
      const point = target ? sourceAnchorPoint(map, connection) : undefined;
      const resolvedTarget = target && point && !target.point ? { ...target, point } : target;
      return label && resolvedTarget
        ? {
            key: tourStopTargetKey(resolvedTarget, label),
            optional: optionalScreenIds?.has(destination.screenId) === true,
          }
        : undefined;
    })
    .filter((target): target is { key: string; optional: boolean } => Boolean(target));
  const allowedTargets = new Map(targets.map((target) => [target.key, target]));
  return fallbackTourStopsFromMap(map, rootScreenId, captureScreenIds).flatMap((stop) => {
    const target = allowedTargets.get(tourStopTargetKey(stop, stop.label));
    if (!target) return [];
    return [{ ...stop, ...(target.optional ? { optional: true } : {}) }];
  });
}

/** The complete ordered row set is only a calibration aid for localized exact
 * tours. It never broadens the selected/captured rows. */
function landmarkTourStopsForExactTour(
  map: AppMap,
  rootScreenId: string,
  fallbackStops: ReadonlyArray<TourStop>,
): TourStop[] {
  if (!fallbackStops.length) return [];
  const landmarks = fallbackTourStopsFromMap(map, rootScreenId);
  // A landmark list only calibrates a *subset* within a longer, complete
  // recorded list. When it is the same list as the selected stops, pairing by
  // rank simply turns the first visible translated rows into our targets.
  // That is how Widget/Advanced were mistaken for Customize/Connectors after
  // a viewport shift. Let the recorded tap points pair those rows instead;
  // if they are stale, fail closed rather than choosing a neighbouring row.
  return landmarks.length > fallbackStops.length ? landmarks : [];
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
  return (
    work.capture?.mode ??
    (work.kind !== "scenario" && work.screenshotEach === false ? "none" : "every-screen")
  );
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
  work: AppMapScenarioTest,
  options?: { warmSetup?: boolean; warmSetupFrom?: AppMapCompiledFlow },
): { root: Recipe; graph: Record<string, Recipe>; plan: AppMapCompiledTest };
export function compileAppMapTest(
  map: AppMap,
  work: AppMapTest,
  options?: { warmSetup?: boolean; warmSetupFrom?: AppMapCompiledFlow },
): { root: Recipe; graph: Record<string, Recipe>; plan?: AppMapCompiledTest };
export function compileAppMapTest(
  map: AppMap,
  work: AppMapTest,
  options: { warmSetup?: boolean; warmSetupFrom?: AppMapCompiledFlow } = {},
): { root: Recipe; graph: Record<string, Recipe>; plan?: AppMapCompiledTest } {
  if (work.kind === "path") {
    const flowId = work.flowId?.trim();
    if (!flowId || !map.flows[flowId]) throw new Error(`Test “${work.name}” is missing its path`);
    const plan = compileAppMapFlow(map, flowId);
    let graph = recipeGraphFromCompiledFlow(map, plan);
    if (options.warmSetup) {
      graph = warmCompiledFlowGraphFromSharedPrefix(graph, plan, options.warmSetupFrom);
    }
    let root = graph[plan.rootRecipeId];
    if (!root) throw new Error(`Test “${work.name}” compiled without a root recipe`);
    const evidenceMode = captureMode(work);
    if (evidenceMode === "every-screen") {
      // A reusable Flow already verifies every recorded destination. Preserve
      // that useful progress in a Path test as inspectable visual evidence,
      // rather than leaving a full replay with only a before/after frame.
      for (const [id, recipe] of Object.entries(graph)) {
        graph[id] = {
          ...recipe,
          steps: recipe.steps.flatMap((step) => [
            step,
            ...(step.kind === "expect-screen"
              ? [
                  {
                    kind: "screenshot" as const,
                    caption: `screen:${step.screenTitle ?? step.screenId ?? "destination"}`,
                  },
                ]
              : []),
          ]),
        };
      }
      root = graph[plan.rootRecipeId]!;
    } else {
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
  if (work.kind === "scenario") {
    return compileAppMapScenarioTest(map, work);
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
  const originObservations = (screen?.variantIds ?? [])
    .map((variantId) => map.screenVariants[variantId]?.observation)
    .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation));
  const exactScreenIds = work.screenIds?.length ? new Set(work.screenIds) : undefined;
  const optionalScreenIds = new Set(work.optionalScreenIds ?? []);
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
    ? fallbackTourStopsForScreens(
        map,
        work.rootScreenId,
        exactScreenIds,
        checkpointIds,
        optionalScreenIds,
      )
    : fallbackTourStopsFromMap(map, work.rootScreenId, checkpointIds);
  const landmarkStops = exactScreenIds
    ? landmarkTourStopsForExactTour(map, work.rootScreenId, fallbackStops)
    : [];
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
      ...(originObservations.length ? { originObservations } : {}),
      ...(prelude.length && (!exactScreenIds || runPreludeInTour) ? { preludeSteps: prelude } : {}),
      ...(prelude.length && preludeStartFingerprint ? { preludeStartFingerprint } : {}),
      ...(prelude.length && preludeStartAliases.length ? { preludeStartAliases } : {}),
      ...(captureOrigin ? { captureOrigin: true } : {}),
      ...(setupPlan ? { originVerifiedBySetup: true } : {}),
      ...(fallbackStops.length ? { fallbackStops } : {}),
      ...(landmarkStops.length ? { landmarkStops } : {}),
      ...(exactScreenIds ? { mappedStopsOnly: true } : {}),
      ...(evidenceMode !== "final-screen" ? { returnAfterLast: false } : {}),
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
  const setupGraph = setupPlan ? recipeGraphFromCompiledFlow(map, setupPlan) : undefined;
  return {
    root,
    graph: {
      ...(setupGraph
        ? options.warmSetup
          ? warmCompiledFlowGraphFromSharedPrefix(setupGraph, setupPlan!, options.warmSetupFrom)
          : setupGraph
        : {}),
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
  let previousSetupPlan: AppMapCompiledFlow | undefined;
  for (const [index, testId] of combine.testIds.entries()) {
    const work = map.tests?.[testId];
    if (!work) throw new Error(`Test ${testId} is missing`);
    const setupFlowId = work.kind === "tour" ? work.setupFlowId?.trim() : undefined;
    const tourRootScreenId = work.kind === "tour" ? work.rootScreenId : undefined;
    const setupPlan =
      setupFlowId && tourRootScreenId
        ? compileAppMapTourSetupFlow(map, setupFlowId, tourRootScreenId)
        : undefined;
    const compiled = compileAppMapTest(
      map,
      {
        ...work,
        ...(combine.captures?.[testId] ? { capture: combine.captures[testId] } : {}),
      },
      {
        warmSetup: index > 0,
        ...(previousSetupPlan ? { warmSetupFrom: previousSetupPlan } : {}),
      },
    );
    Object.assign(graph, compiled.graph);
    modules.push({
      id: `relay-check-${testId}`,
      kind: "module",
      recipeId: compiled.root.id,
      check: { id: testId, title: work.name },
    });
    if (setupPlan) {
      previousSetupPlan = setupPlan;
    } else if (work.kind === "path" && work.flowId?.trim()) {
      // A Path ends at a verified flow terminal, so it is a valid predecessor
      // for the following tour's shared-prefix recovery.
      previousSetupPlan = compileAppMapFlow(map, work.flowId);
    } else {
      previousSetupPlan = undefined;
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
