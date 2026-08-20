/**
 * Compile-time scheduling for independent App Map checks.
 *
 * The scheduler is intentionally a read-only proof model. It may describe a
 * faster sibling order, but it never rewrites the saved Test, executes a
 * recovery, or treats a coordinate as navigation truth. A check joins a
 * reorderable segment only when its own terminal has one narrow, reviewed
 * return to the same semantic source as every sibling.
 */
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapTestExecutionScheduleCheck,
  AppMapTestExecutionScheduleReason,
  AppMapTestReviewedReturnEquivalence,
  Connection,
  RecipeStep,
  StepTarget,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";

type Schedule = NonNullable<AppMapCompiledTest["executionSchedule"]>;
type CheckMetadata = NonNullable<RecipeStep["check"]>;
type TransitionDependency = NonNullable<CheckMetadata["transitionDependencies"]>[number];

type DocumentPosition =
  | {
      status: "resolved";
      sourceScreenId: string;
      semanticDocumentOrder: number;
      documentY: number;
    }
  | { status: "unknown" | "conflicting" };

type PreparedCheck = {
  output: AppMapTestExecutionScheduleCheck;
  terminalScreenId?: string;
  /** True only when the check can be entered from its semantic source and
   * independently returns there through reviewed graph evidence. */
  reorderable: boolean;
};

function textKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  return normalized || undefined;
}

function targetKey(target: StepTarget): string | undefined {
  const semantic = target.relation?.anchor ?? target;
  const identifier = textKey(semantic.identifier);
  if (identifier) return `identifier:${identifier}`;
  const ref = textKey(semantic.ref?.replace(/^@/u, ""));
  if (ref) return `ref:${ref}`;
  const label = textKey(semantic.label);
  if (label) return `label:${label}:${textKey(semantic.role) ?? ""}`;
  const text = textKey(semantic.text);
  return text ? `text:${text}:${textKey(semantic.role) ?? ""}` : undefined;
}

function targetMatchesAnchor(
  target: StepTarget,
  anchor: { target: StepTarget; label?: string; role?: string },
): boolean {
  const semantic = target.relation?.anchor ?? target;
  const anchorTarget = anchor.target.relation?.anchor ?? anchor.target;
  const identifier = textKey(semantic.identifier);
  if (identifier) return identifier === textKey(anchorTarget.identifier);
  const ref = textKey(semantic.ref?.replace(/^@/u, ""));
  if (ref) return ref === textKey(anchorTarget.ref?.replace(/^@/u, ""));
  const role = textKey(semantic.role);
  const anchorRole = textKey(anchor.role ?? anchorTarget.role);
  if (role && role !== anchorRole) return false;
  const label = textKey(semantic.label);
  if (label) return label === textKey(anchor.label ?? anchorTarget.label);
  const text = textKey(semantic.text);
  return (
    text !== undefined && text === textKey(anchor.label ?? anchorTarget.label ?? anchorTarget.text)
  );
}

function targetsForConnection(connection: Connection): StepTarget[] {
  if (connection.navigation?.targetAlternatives.length) {
    return connection.navigation.targetAlternatives.flatMap((target) => {
      if (target.kind === "identifier") return [{ identifier: target.identifier }];
      if (target.kind === "accessibility") {
        return [{ label: target.label, ...(target.role ? { role: target.role } : {}) }];
      }
      return [structuredClone(target.anchor)];
    });
  }
  return connection.actions.flatMap((action) => {
    if (action.kind === "tap" || action.kind === "reveal") return [action.target];
    if (action.kind !== "recorded" && action.kind !== "steps") return [];
    return action.steps.flatMap((step) =>
      step.kind === "tap" || step.kind === "reveal" ? [step.target] : [],
    );
  });
}

/** A semantic surface is frozen evidence. Pick one deterministic current
 * revision per Variant, then require every available Variant to agree on the
 * anchor ordinal. Taking the minimum coordinate across conflicting localizations
 * would turn a guess into a schedule. */
function documentPositionForConnection(map: AppMap, connection: Connection): DocumentPosition {
  const targets = targetsForConnection(connection);
  if (!targets.length) return { status: "unknown" };
  const targetKeys = new Set(targets.map(targetKey).filter((key): key is string => Boolean(key)));
  if (!targetKeys.size) return { status: "unknown" };

  const positions: Array<{ semanticDocumentOrder: number; documentY: number }> = [];
  const variants = Object.values(map.screenVariants)
    .filter((variant) => variant.screenId === connection.fromScreenId)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const variant of variants) {
    const surface = [...(variant.scrollSurfaces ?? [])]
      .filter((candidate) => candidate.semanticIndex)
      .sort(
        (left, right) =>
          right.capturedAt - left.capturedAt ||
          String(right.captureId ?? "").localeCompare(String(left.captureId ?? "")) ||
          String(right.id ?? "").localeCompare(String(left.id ?? "")),
      )[0];
    if (!surface?.semanticIndex) continue;
    const matches = surface.semanticIndex.anchors.filter((anchor) =>
      targets.some((target) => targetMatchesAnchor(target, anchor)),
    );
    // Several alternatives may refer to the same anchor, but two anchors are
    // not a safe semantic selector. The index compiler already rejects most
    // duplicates; preserve that fail-closed behavior at the schedule seam.
    if (matches.length !== 1) return { status: matches.length ? "conflicting" : "unknown" };
    const match = matches[0]!;
    positions.push({ semanticDocumentOrder: match.order, documentY: match.documentY });
  }
  if (!positions.length) return { status: "unknown" };
  const orders = new Set(positions.map((position) => position.semanticDocumentOrder));
  if (orders.size !== 1) return { status: "conflicting" };
  return {
    status: "resolved",
    sourceScreenId: connection.fromScreenId,
    semanticDocumentOrder: positions[0]!.semanticDocumentOrder,
    // Geometry is illustrative, not the key used to order checks. Keeping the
    // minimum makes the inspectable coordinate deterministic across variants.
    documentY: Math.min(...positions.map((position) => position.documentY)),
  };
}

function sameDestination(
  left: TransitionDependency["destination"],
  right: Connection["destination"],
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== "screen" || right.kind !== "screen" || left.screenId === right.screenId)
  );
}

function exactReadyReverseConnection(
  map: AppMap,
  sourceScreenId: string,
  terminalScreenId: string,
): Connection | undefined {
  const matches = Object.values(map.connections)
    .filter(
      (candidate) =>
        candidate.state === "ready" &&
        candidate.fromScreenId === terminalScreenId &&
        candidate.destination.kind === "screen" &&
        candidate.destination.screenId === sourceScreenId,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return matches.length === 1 ? matches[0] : undefined;
}

function ownerApp(map: AppMap, screenId: string): string | undefined {
  return map.screens[screenId]?.handoff?.ownerApp;
}

function actionCrossesExternalBoundary(action: Connection["actions"][number]): boolean {
  if (action.kind === "tap") return Boolean(action.expectedApp);
  if (action.kind === "app") return action.action === "open" && Boolean(action.url);
  if (action.kind !== "recorded" && action.kind !== "steps") return false;
  return action.steps.some(
    (step) => (step.kind === "tap" || step.kind === "expect-screen") && Boolean(step.expectedApp),
  );
}

function crossesExternalBoundary(
  map: AppMap,
  dependency: TransitionDependency,
  connection: Connection,
): boolean {
  if (dependency.expectedApp || connection.return?.expectedApp) return true;
  if (connection.actions.some(actionCrossesExternalBoundary)) return true;
  if (ownerApp(map, connection.fromScreenId)) return true;
  return (
    connection.destination.kind === "screen" &&
    Boolean(ownerApp(map, connection.destination.screenId))
  );
}

/** Derive exactly one inverse from the leaf itself. This deliberately does not
 * search arbitrary graph paths: a full graph traversal could make a sibling
 * look equivalent through an unrelated setting, state mutation, or handoff. */
function reviewedReturnToSource(
  map: AppMap,
  connection: Connection,
): AppMapTestReviewedReturnEquivalence | undefined {
  if (connection.destination.kind !== "screen") return undefined;
  const terminalScreenId = connection.destination.screenId;
  if (
    connection.return?.kind === "back" &&
    connection.return.expectedDestination.screenId === connection.fromScreenId
  ) {
    return {
      sourceScreenId: connection.fromScreenId,
      terminalScreenId,
      kind: "back",
      connectionIds: [connection.id],
    };
  }
  const inverse = exactReadyReverseConnection(map, connection.fromScreenId, terminalScreenId);
  if (
    !inverse ||
    inverse.return?.expectedApp ||
    ownerApp(map, inverse.fromScreenId) ||
    (inverse.destination.kind === "screen" && ownerApp(map, inverse.destination.screenId))
  ) {
    return undefined;
  }
  return {
    sourceScreenId: connection.fromScreenId,
    terminalScreenId,
    kind: "connection",
    connectionIds: [inverse.id],
  };
}

type RecipeBoundary = "safe" | "external-handoff" | "cold-reset-branch";

function directRecipeBoundary(step: RecipeStep): Exclude<RecipeBoundary, "safe"> | undefined {
  if ((step.kind === "tap" || step.kind === "expect-screen") && step.expectedApp) {
    return "external-handoff";
  }
  if (step.kind === "app") {
    if (step.action === "open" && step.url) return "external-handoff";
    if (step.action === "open" && step.relaunch !== true) return undefined;
    if (!["inspect", "assert-installed", "assert-not-installed"].includes(step.action)) {
      return "cold-reset-branch";
    }
  }
  if (["rotate", "settings", "location", "permission"].includes(step.kind)) {
    return "cold-reset-branch";
  }
  if (step.kind === "device" && ["lock", "unlock"].includes(step.action)) {
    return "cold-reset-branch";
  }
  return step.kind === "key" && step.key === "home" ? "cold-reset-branch" : undefined;
}

function recipeBoundary(
  graph: Readonly<Record<string, Recipe>>,
  recipeId: string,
  seen = new Set<string>(),
): RecipeBoundary {
  if (seen.has(recipeId)) return "safe";
  seen.add(recipeId);
  const recipe = graph[recipeId];
  // Direct scheduler callers may intentionally provide a lightweight graph
  // that has only its root. Missing child recipe data is not permission to
  // manufacture a reset diagnosis; normal compilation still includes it.
  if (!recipe) return "safe";
  let cold = false;
  for (const step of recipe.steps) {
    const direct = directRecipeBoundary(step);
    if (direct === "external-handoff") return direct;
    if (direct === "cold-reset-branch") cold = true;
    const children =
      step.kind === "module" || step.kind === "repeat"
        ? [step.recipeId]
        : step.kind === "branch"
          ? [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])]
          : [];
    for (const child of children) {
      const nested = recipeBoundary(graph, child, seen);
      if (nested === "external-handoff") return nested;
      if (nested === "cold-reset-branch") cold = true;
    }
  }
  return cold ? "cold-reset-branch" : "safe";
}

function baseCheck(
  step: Extract<RecipeStep, { kind: "module" }> & { check: CheckMetadata },
  authoredIndex: number,
): AppMapTestExecutionScheduleCheck {
  const sourceScreenId =
    step.check.warmSourceScreenId ?? step.check.transitionDependencies?.[0]?.originScreenId;
  return {
    checkId: step.check.id,
    recipeId: step.recipeId,
    authoredIndex,
    proposedIndex: authoredIndex,
    ...(sourceScreenId ? { sourceScreenId } : {}),
    disposition: "fixed",
    reason: "authored-order",
  };
}

function blocked(
  output: AppMapTestExecutionScheduleCheck,
  disposition: "fixed" | "deferred",
  reason: AppMapTestExecutionScheduleReason,
): PreparedCheck {
  return { output: { ...output, disposition, reason }, reorderable: false };
}

function scheduleReady(input: {
  output: AppMapTestExecutionScheduleCheck;
  sourceScreenId: string;
  terminalScreenId: string;
  position: Extract<DocumentPosition, { status: "resolved" }>;
  returnToSource: AppMapTestReviewedReturnEquivalence;
}): PreparedCheck {
  return {
    output: {
      ...input.output,
      sourceScreenId: input.sourceScreenId,
      semanticDocumentOrder: input.position.semanticDocumentOrder,
      documentY: input.position.documentY,
      disposition: "scheduled",
      reason: "reviewed-return-equivalence",
      returnToSource: input.returnToSource,
    },
    terminalScreenId: input.terminalScreenId,
    reorderable: true,
  };
}

/** Build an inspectable schedule for a frozen compiled graph. It contains no
 * device calls and does not mutate `map` or `graph`; execution still requires
 * its normal live source proof and explicit review of a reordered proposal. */
export function proposeAppMapTestExecutionSchedule(
  map: AppMap,
  rootRecipeId: string,
  graph: Readonly<Record<string, Recipe>>,
): Schedule {
  const root = graph[rootRecipeId];
  if (!root) return { schemaVersion: 2, mode: "authored", checks: [], deferredBranches: [] };

  const rawChecks = root.steps.flatMap((step) =>
    step.kind === "module" && step.check
      ? [step as Extract<RecipeStep, { kind: "module" }> & { check: CheckMetadata }]
      : [],
  );
  const deferredBranches: Schedule["deferredBranches"] = [];
  const prepared: PreparedCheck[] = [];

  for (const [authoredIndex, step] of rawChecks.entries()) {
    const output = baseCheck(step, authoredIndex);
    const check = step.check;
    if (check.recovery?.coldRecipeId) {
      deferredBranches.push({
        checkId: check.id,
        recipeId: check.recovery.coldRecipeId,
        reason: "cold-reset-branch",
      });
    }
    if (check.cleanup) {
      prepared.push(blocked(output, "fixed", "cleanup-boundary"));
      continue;
    }
    const branchBoundary = recipeBoundary(graph, step.recipeId);
    if (branchBoundary !== "safe") {
      prepared.push(blocked(output, "deferred", branchBoundary));
      continue;
    }
    const dependencies = check.transitionDependencies ?? [];
    // Only a single direct leaf can prove a sibling relationship. Multi-edge
    // paths remain in authored order instead of guessing which intermediate
    // state or return chain should be shared.
    if (dependencies.length !== 1) {
      prepared.push(blocked(output, "fixed", "prerequisite-boundary"));
      continue;
    }
    const dependency = dependencies[0]!;
    const connection = map.connections[dependency.connectionId];
    if (
      !connection ||
      connection.state !== "ready" ||
      connection.fromScreenId !== dependency.originScreenId ||
      !sameDestination(dependency.destination, connection.destination)
    ) {
      prepared.push(blocked(output, "deferred", "unknown-cursor"));
      continue;
    }
    if (crossesExternalBoundary(map, dependency, connection)) {
      prepared.push(blocked(output, "deferred", "external-handoff"));
      continue;
    }
    if (connection.destination.kind !== "screen") {
      prepared.push(blocked(output, "deferred", "unknown-cursor"));
      continue;
    }
    const position = documentPositionForConnection(map, connection);
    if (position.status !== "resolved") {
      prepared.push(
        blocked(
          output,
          position.status === "conflicting" ? "deferred" : "fixed",
          position.status === "conflicting"
            ? "conflicting-document-order"
            : "unknown-document-position",
        ),
      );
      continue;
    }
    const returnToSource = reviewedReturnToSource(map, connection);
    if (!returnToSource) {
      prepared.push(blocked(output, "fixed", "missing-reviewed-return"));
      continue;
    }

    const sourceScreenId = position.sourceScreenId;
    const previous = prepared.at(-1);
    const startsAtProvenSource =
      (authoredIndex === 0 && check.warmSourceScreenId === undefined) ||
      check.warmSourceScreenId === sourceScreenId ||
      (check.warmSourceScreenId !== undefined &&
        previous?.reorderable === true &&
        previous.terminalScreenId === check.warmSourceScreenId &&
        previous.output.returnToSource?.sourceScreenId === sourceScreenId);
    if (!startsAtProvenSource) {
      prepared.push(blocked(output, "deferred", "unknown-cursor"));
      continue;
    }
    prepared.push(
      scheduleReady({
        output,
        sourceScreenId,
        terminalScreenId: connection.destination.screenId,
        position,
        returnToSource,
      }),
    );
  }

  // Reorder only contiguous, independently returnable siblings. A fixed or
  // deferred entry is a hard boundary, as is a semantic-source change. The
  // result stays a review proposal; no recipe order changes here.
  const checks = prepared.map((item) => item.output);
  for (let start = 0; start < checks.length;) {
    const first = prepared[start]!;
    const sourceScreenId = first.output.sourceScreenId;
    if (!first.reorderable || !sourceScreenId) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (
      end < prepared.length &&
      prepared[end]!.reorderable &&
      prepared[end]!.output.sourceScreenId === sourceScreenId
    ) {
      end += 1;
    }
    const segment = checks
      .slice(start, end)
      .sort(
        (left, right) =>
          left.semanticDocumentOrder! - right.semanticDocumentOrder! ||
          left.authoredIndex - right.authoredIndex,
      );
    checks.splice(start, segment.length, ...segment);
    start = end;
  }
  const withIndexes = checks.map((check, proposedIndex) => ({ ...check, proposedIndex }));
  const authoredIndexById = new Map(
    withIndexes.map((check) => [check.checkId, check.authoredIndex]),
  );
  const hasProposal = withIndexes.some((check) => check.proposedIndex !== check.authoredIndex);
  return {
    schemaVersion: 2,
    mode:
      hasProposal ||
      withIndexes.some((check) => check.disposition === "deferred") ||
      deferredBranches.length > 0
        ? "review-required"
        : "authored",
    checks: withIndexes,
    deferredBranches: deferredBranches.sort(
      (left, right) =>
        (authoredIndexById.get(left.checkId) ?? Number.MAX_SAFE_INTEGER) -
          (authoredIndexById.get(right.checkId) ?? Number.MAX_SAFE_INTEGER) ||
        left.recipeId.localeCompare(right.recipeId),
    ),
  };
}
