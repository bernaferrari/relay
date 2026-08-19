import { createHash } from "node:crypto";
import type {
  AppMap,
  AppMapScenarioTest,
  CampaignRepairAction,
  CampaignRepairTarget,
  CampaignRepairTargetSummary,
} from "@relay/protocol";
import { PRIVATE_INPUT } from "./private-inputs.js";
import { REDACTED } from "./redaction.js";
import type { PersistedRun } from "./runs.js";
import type { EnqueueJobInput } from "./session-contract.js";
import type { Recipe, RecipeStep } from "./recipes.js";
import { compileAppMapConnection } from "./app-map-compiler.js";
import { compileAppMapTest } from "./map-work.js";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function lastMatching<T>(
  values: readonly T[] | undefined,
  predicate: (value: T) => boolean,
): T | undefined {
  if (!values) return undefined;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]!;
    if (predicate(value)) return value;
  }
  return undefined;
}

function repairTargetId(runId: string, checkId: string): string {
  return `${runId}:${checkId}`;
}

function resultArtifacts(run: PersistedRun): Array<{
  artifact: PersistedRun["artifacts"][number];
  data: RecordValue;
}> {
  return (run.artifacts ?? []).flatMap((artifact) => {
    const data = record(artifact.data);
    return artifact.kind === "campaign-check-result" && data ? [{ artifact, data }] : [];
  });
}

function failedResult(run: PersistedRun, checkId: string) {
  return lastMatching(
    resultArtifacts(run),
    ({ data }) => data.id === checkId && (data.status === "failed" || data.status === "blocked"),
  );
}

export function campaignRepairPlanIdentity(run: PersistedRun): {
  appMapId?: string;
  appMapRevision?: number;
  testId?: string;
} {
  const plan = record(
    lastMatching(run.artifacts, (artifact) => artifact.kind === "app-map-test-plan")?.data,
  );
  const test = record(plan?.test);
  return {
    ...(text(plan?.appMapId) ? { appMapId: text(plan?.appMapId) } : {}),
    ...(number(plan?.appMapRevision) !== undefined
      ? { appMapRevision: number(plan?.appMapRevision) }
      : {}),
    ...(text(test?.id) ? { testId: text(test?.id) } : {}),
  };
}

function frozenCheckStep(
  run: PersistedRun,
  checkId: string,
): (RecipeStep & { check: NonNullable<RecipeStep["check"]> }) | undefined {
  const recipes = [run.recipeSnapshot, ...Object.values(run.recipeGraph ?? {})].filter(
    (recipe): recipe is Recipe => Boolean(recipe),
  );
  return recipes
    .flatMap((recipe) => recipe.steps)
    .find(
      (step): step is RecipeStep & { check: NonNullable<RecipeStep["check"]> } =>
        step.check?.id === checkId,
    );
}

function expectedScreenId(recipe: Recipe | undefined): string | undefined {
  return recipe?.steps
    .flatMap((step) => (step.kind === "expect-screen" ? [step.screenId] : []))
    .at(-1);
}

type RepairPlan = {
  sourceCheckStep: RecipeStep & { check: NonNullable<RecipeStep["check"]> };
  checkStep: RecipeStep & { check: NonNullable<RecipeStep["check"]> };
  executableRecipeId: string;
  origin: Extract<RecipeStep, { kind: "expect-screen" }>;
  transitionId?: string;
  graph: Record<string, Recipe>;
  reconciliation?: CampaignRepairReconciliation["identity"];
};

export type CampaignRepairReconciliation = {
  sourceRunId: string;
  sourceCheckId: string;
  identity: {
    appMapId: string;
    appMapRevision: number;
    appMapDigest: string;
    testId: string;
    compiledPlanDigest: string;
  };
  plan: RepairPlan;
};

function referencedRecipeIds(step: RecipeStep): string[] {
  if (step.kind === "module" || step.kind === "repeat") return [step.recipeId];
  if (step.kind === "flow") return [step.flow];
  if (step.kind === "branch") {
    return [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])];
  }
  return [];
}

function reachableSteps(
  graph: Readonly<Record<string, Recipe>>,
  recipeId: string,
  seen = new Set<string>(),
): RecipeStep[] {
  if (seen.has(recipeId)) return [];
  const recipe = graph[recipeId];
  if (!recipe) throw new Error(`Frozen repair recipe ${recipeId} is missing`);
  seen.add(recipeId);
  return recipe.steps.flatMap((step) => [
    step,
    ...referencedRecipeIds(step).flatMap((childId) => reachableSteps(graph, childId, seen)),
  ]);
}

function unsafeWarmRepairEffect(step: RecipeStep): string | undefined {
  if (step.kind === "app") return `app ${step.action}`;
  if (step.kind === "tour") return "tour navigation";
  if (step.kind === "key" && step.key === "home") return "Home navigation";
  if (["device", "rotate", "settings", "location", "permission"].includes(step.kind)) {
    return `${step.kind} mutation`;
  }
  return undefined;
}

function frozenRepairPlan(run: PersistedRun, checkId: string): RepairPlan | undefined {
  const checkStep = frozenCheckStep(run, checkId);
  if (!checkStep || !run.recipeGraph) return undefined;
  const terminalDependency = checkStep.check.transitionDependencies?.at(-1);
  if (!terminalDependency) return undefined;
  const transitionId = terminalDependency.connectionId;
  const originScreenId = terminalDependency.originScreenId;
  const candidates = Object.entries(run.recipeGraph).filter(
    ([id, recipe]) =>
      id.includes(`:connection:${transitionId}:`) ||
      recipe.steps.some(
        (step) => step.kind === "tap" && step.navigationContract?.connectionId === transitionId,
      ),
  );
  if (candidates.length !== 1) return undefined;
  const executableRecipeId = candidates[0]![0];
  const executableSteps = reachableSteps(run.recipeGraph, executableRecipeId);
  const origin = executableSteps.find(
    (step): step is Extract<RecipeStep, { kind: "expect-screen" }> =>
      step.kind === "expect-screen" && (!originScreenId || step.screenId === originScreenId),
  );
  if (!origin) return undefined;
  const steps = [
    ...executableSteps,
    ...(checkStep.check.cleanup
      ? reachableSteps(run.recipeGraph, checkStep.check.cleanup.recipeId)
      : []),
  ];
  const unsafe = steps.find((step) => unsafeWarmRepairEffect(step));
  if (unsafe) {
    throw new Error(
      `Live-checkpoint repair refuses ${unsafeWarmRepairEffect(unsafe)} in ${executableRecipeId}`,
    );
  }
  return {
    sourceCheckStep: checkStep,
    checkStep,
    executableRecipeId,
    origin,
    transitionId,
    graph: run.recipeGraph,
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameTerminalDependency(
  left: NonNullable<NonNullable<RecipeStep["check"]>["transitionDependencies"]>[number],
  right: NonNullable<NonNullable<RecipeStep["check"]>["transitionDependencies"]>[number],
): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.originScreenId === right.originScreenId &&
    JSON.stringify(left.destination) === JSON.stringify(right.destination)
  );
}

function recipeFromCompiled(
  map: AppMap,
  compiled: {
    id: string;
    title: string;
    description?: string;
    steps: RecipeStep[];
  },
): Recipe {
  return {
    id: compiled.id,
    title: compiled.title,
    ...(compiled.description ? { description: compiled.description } : {}),
    source: "custom",
    steps: structuredClone(compiled.steps),
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
  };
}

function uniqueCheckStep(
  root: Recipe,
  graph: Readonly<Record<string, Recipe>>,
  checkId: string,
): (RecipeStep & { check: NonNullable<RecipeStep["check"]> }) | undefined {
  const recipes = new Map<string, Recipe>([[root.id, root], ...Object.entries(graph)]);
  const matches = [...recipes.values()].flatMap((recipe) =>
    recipe.steps.filter(
      (step): step is RecipeStep & { check: NonNullable<RecipeStep["check"]> } =>
        step.check?.id === checkId,
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function includeReachableRecipes(
  source: Readonly<Record<string, Recipe>>,
  target: Record<string, Recipe>,
  recipeId: string,
): void {
  if (target[recipeId]) return;
  const recipe = source[recipeId];
  if (!recipe) throw new Error(`Reconciled repair recipe ${recipeId} is missing`);
  target[recipeId] = structuredClone(recipe);
  for (const step of recipe.steps) {
    for (const childId of referencedRecipeIds(step)) {
      includeReachableRecipes(source, target, childId);
    }
  }
}

/**
 * Reconcile only an un-runnable frozen terminal edge against the current saved
 * Test. Stable check identity and the complete terminal graph dependency must
 * still match; this never infers an edge from labels or recipe names.
 */
export function reconcileCampaignCheckRepair(
  run: PersistedRun,
  checkId: string,
  map: AppMap,
  test: AppMapScenarioTest,
): CampaignRepairReconciliation | undefined {
  if (frozenRepairPlan(run, checkId)) return undefined;
  const identity = campaignRepairPlanIdentity(run);
  if (identity.appMapId !== map.id || identity.testId !== test.id) return undefined;
  const sourceCheckStep = frozenCheckStep(run, checkId);
  const sourceTerminal = sourceCheckStep?.check.transitionDependencies?.at(-1);
  if (!sourceCheckStep || !sourceTerminal) return undefined;

  const compiledTest = compileAppMapTest(map, test);
  const currentCheckStep = uniqueCheckStep(compiledTest.root, compiledTest.graph, checkId);
  const currentTerminal = currentCheckStep?.check.transitionDependencies?.at(-1);
  if (
    !currentCheckStep ||
    !currentTerminal ||
    !sameTerminalDependency(sourceTerminal, currentTerminal)
  ) {
    return undefined;
  }

  const compiledConnection = compileAppMapConnection(map, sourceTerminal.connectionId);
  const graph = Object.fromEntries(
    Object.values(compiledConnection.recipes).map((recipe) => [
      recipe.id,
      recipeFromCompiled(map, recipe),
    ]),
  );
  const executableRecipeId = compiledConnection.rootRecipeId;
  const executableSteps = reachableSteps(graph, executableRecipeId);
  const origin = executableSteps.find(
    (step): step is Extract<RecipeStep, { kind: "expect-screen" }> =>
      step.kind === "expect-screen" && step.screenId === sourceTerminal.originScreenId,
  );
  if (!origin) return undefined;
  if (currentCheckStep.check.cleanup) {
    includeReachableRecipes(compiledTest.graph, graph, currentCheckStep.check.cleanup.recipeId);
  }
  const inspectedSteps = [
    ...executableSteps,
    ...(currentCheckStep.check.cleanup
      ? reachableSteps(graph, currentCheckStep.check.cleanup.recipeId)
      : []),
  ];
  const unsafe = inspectedSteps.find((step) => unsafeWarmRepairEffect(step));
  if (unsafe) {
    throw new Error(
      `Live-checkpoint repair refuses ${unsafeWarmRepairEffect(unsafe)} in ${executableRecipeId}`,
    );
  }
  const reconciliationIdentity = {
    appMapId: map.id,
    appMapRevision: map.revision,
    appMapDigest: digest(map),
    testId: test.id,
    compiledPlanDigest: digest(compiledTest.plan),
  };
  const plan: RepairPlan = {
    sourceCheckStep,
    checkStep: currentCheckStep,
    executableRecipeId,
    origin,
    transitionId: sourceTerminal.connectionId,
    graph,
    reconciliation: reconciliationIdentity,
  };
  return {
    sourceRunId: run.id,
    sourceCheckId: checkId,
    identity: reconciliationIdentity,
    plan,
  };
}

function repairPlan(
  run: PersistedRun,
  checkId: string,
  reconciliation?: CampaignRepairReconciliation,
): RepairPlan | undefined {
  const frozen = frozenRepairPlan(run, checkId);
  if (frozen) return frozen;
  if (
    reconciliation?.sourceRunId !== run.id ||
    reconciliation.sourceCheckId !== checkId ||
    reconciliation.identity.appMapId !== campaignRepairPlanIdentity(run).appMapId ||
    reconciliation.identity.testId !== campaignRepairPlanIdentity(run).testId
  ) {
    return undefined;
  }
  return reconciliation.plan;
}

const proposalRequirements = {
  actorAttribution: true,
  priorRevision: true,
  reviewRequired: true,
  inverseEditsForRevert: true,
  equivalentDiffGrouping: true,
} as const;

function actions(input: {
  runId: string;
  checkId: string;
  retryAvailable: boolean;
  appMapId?: string;
  appMapRevision?: number;
  testId?: string;
  retargetSelector?: unknown;
  acceptCurrentAvailable: boolean;
}): CampaignRepairAction[] {
  const proposalAvailable = Boolean(
    input.appMapId && input.testId && input.appMapRevision !== undefined,
  );
  const proposalFixedInput = proposalAvailable
    ? {
        appMapId: input.appMapId,
        testId: input.testId,
        expectedRevision: input.appMapRevision,
        title: `Repair check ${input.checkId}`,
        description: `Proposed from failed check ${input.checkId} in immutable run ${input.runId}.`,
      }
    : undefined;
  return [
    {
      kind: "continue-and-report",
      label: "Continue and report",
      available: true,
      mutation: "none",
      description:
        "Keep the original failure and continue triage without changing the Test or baseline.",
    },
    {
      kind: "retry-check",
      label: "Retry only this check",
      available: input.retryAvailable,
      mutation: "new-run",
      description:
        "Verify the live origin, then create a lineage-linked run containing only the warm failed check.",
      operationId: "run.repair.retry",
      fixedInput: { runId: input.runId, checkId: input.checkId },
      ...(!input.retryAvailable
        ? {
            unavailableReason:
              "The source run has no frozen origin proof and warm executable recipe for this check.",
          }
        : {}),
    },
    {
      kind: "retarget-proposal",
      label: "Use proven selector",
      available: proposalAvailable && input.retargetSelector !== undefined,
      mutation: "reviewed-proposal",
      description:
        "Promote the exact selector that succeeded at runtime into a reversible connection proposal.",
      operationId: "run.repair.propose",
      fixedInput: {
        runId: input.runId,
        checkId: input.checkId,
        kind: "retarget",
        ...(input.retargetSelector !== undefined
          ? { selector: structuredClone(input.retargetSelector) }
          : {}),
      },
      requiredInput: ["reason"],
      ...(!proposalAvailable || input.retargetSelector === undefined
        ? { unavailableReason: "No successful replacement selector was preserved for this check." }
        : {}),
      proposalRequirements,
    },
    {
      kind: "accept-current-proposal",
      label: "Accept current via proposal",
      available: proposalAvailable && input.acceptCurrentAvailable,
      mutation: "reviewed-proposal",
      description:
        "Add the observed semantic identity as a reviewed alias without replacing the approved baseline.",
      operationId: "run.repair.propose",
      fixedInput: {
        runId: input.runId,
        checkId: input.checkId,
        kind: "accept-current",
      },
      requiredInput: ["reason"],
      ...(!proposalAvailable || !input.acceptCurrentAvailable
        ? {
            unavailableReason: "This check has no mapped Screen and observed semantic fingerprint.",
          }
        : {}),
      proposalRequirements,
    },
    {
      kind: "repair-test-proposal",
      label: "Repair Test",
      available: proposalAvailable,
      mutation: "reviewed-proposal",
      description:
        "Retarget or rebind the stable Test step through the existing semantic Test proposal review flow.",
      operationId: "app-map.test.propose",
      ...(proposalFixedInput ? { fixedInput: proposalFixedInput } : {}),
      requiredInput: ["edits"],
      ...(!proposalAvailable
        ? { unavailableReason: "The source run does not identify an App Map revision and Test." }
        : {}),
      proposalRequirements,
    },
    {
      kind: "defer-check-proposal",
      label: "Defer check via proposal",
      available: proposalAvailable,
      mutation: "reviewed-proposal",
      description:
        "Disabling coverage requires an explicit, reversible Test policy diff and review.",
      operationId: "run.repair.propose",
      fixedInput: {
        runId: input.runId,
        checkId: input.checkId,
        kind: "disable",
      },
      requiredInput: ["reason"],
      ...(!proposalAvailable
        ? { unavailableReason: "The source run does not identify a saved Test revision." }
        : {}),
      proposalRequirements,
    },
  ];
}

export function buildCampaignRepairTarget(
  run: PersistedRun,
  checkId: string,
  priorAttempts: CampaignRepairTarget["lineage"]["priorAttempts"] = [],
  reconciliation?: CampaignRepairReconciliation,
): CampaignRepairTarget | null {
  const result = failedResult(run, checkId);
  if (!result) return null;
  const failure = lastMatching(run.artifacts, (artifact) => {
    if (artifact.kind !== "campaign-check-evidence") return false;
    return record(artifact.data)?.checkId === checkId;
  });
  const failureData = record(failure?.data);
  const frozenStep = frozenCheckStep(run, checkId);
  const selectiveRepair = record(result.data.selectiveRepair);
  const recipeId =
    text(selectiveRepair?.recipeId) ??
    frozenStep?.check.recovery?.recipeId ??
    (frozenStep?.kind === "module" ? frozenStep.recipeId : undefined);
  const recipe = recipeId ? run.recipeGraph?.[recipeId] : undefined;
  const identity = campaignRepairPlanIdentity(run);
  const frames = (run.frames ?? []).flatMap((frame, index) =>
    frame.caption === `failed:${checkId}`
      ? [
          {
            index,
            path: frame.path,
            caption: frame.caption,
            capturedAt: frame.capturedAt,
          },
        ]
      : [],
  );
  let checkpointPlan: RepairPlan | undefined;
  try {
    checkpointPlan = run.recipeSnapshot ? repairPlan(run, checkId, reconciliation) : undefined;
  } catch {
    checkpointPlan = undefined;
  }
  const retryAvailable = Boolean(checkpointPlan);
  const terminalDestination =
    checkpointPlan?.checkStep.check.transitionDependencies?.at(-1)?.destination;
  const repairScreenId =
    terminalDestination?.kind === "screen"
      ? terminalDestination.screenId
      : expectedScreenId(
          checkpointPlan ? run.recipeGraph?.[checkpointPlan.executableRecipeId] : recipe,
        );
  const resultStartedAt = number(result.data.startedAt) ?? 0;
  const resultFinishedAt = number(result.data.finishedAt) ?? result.artifact.capturedAt;
  const transitionId = checkpointPlan?.transitionId;
  const navigationRepairArtifact = lastMatching(run.artifacts, (artifact) => {
    if (artifact.kind !== "navigation-repair-proposal") return false;
    if (artifact.capturedAt < resultStartedAt || artifact.capturedAt > resultFinishedAt)
      return false;
    const data = record(artifact.data);
    return !transitionId || data?.connectionId === transitionId;
  });
  const navigationRepairData = record(navigationRepairArtifact?.data);
  const beforeSelector = record(navigationRepairData?.beforeSelector);
  const currentSelector = record(navigationRepairData?.currentSelector);
  return {
    schemaVersion: 1,
    id: repairTargetId(run.id, checkId),
    status: "pending",
    defaultAction: "continue-and-report",
    source: {
      runId: run.id,
      runInputDigest: run.inputDigest,
      checkId,
      checkTitle: text(result.data.title) ?? checkId,
      action: run.action,
      capturedAt: result.artifact.capturedAt,
      ...identity,
    },
    expected: {
      ...(checkpointPlan?.executableRecipeId || recipeId
        ? { recipeId: checkpointPlan?.executableRecipeId ?? recipeId }
        : {}),
      ...(repairScreenId ? { screenId: repairScreenId } : {}),
      ...(text(selectiveRepair?.groupId) || frozenStep?.check.recovery?.groupId
        ? { groupId: text(selectiveRepair?.groupId) ?? frozenStep?.check.recovery?.groupId }
        : {}),
      ...(checkpointPlan
        ? {
            originScreenId: checkpointPlan.origin.screenId,
            ...(checkpointPlan.transitionId ? { transitionId: checkpointPlan.transitionId } : {}),
          }
        : {}),
    },
    observed: {
      error: text(failureData?.error) ?? text(result.data.error) ?? "Check failed",
      ...(failureData?.screenIdentity !== undefined
        ? { screenIdentity: structuredClone(failureData.screenIdentity) }
        : {}),
      ...(failureData?.chrome !== undefined ? { chrome: structuredClone(failureData.chrome) } : {}),
      ...(failureData?.accessibility !== undefined
        ? { accessibility: structuredClone(failureData.accessibility) }
        : {}),
      ...(text(navigationRepairData?.connectionId) && beforeSelector && currentSelector
        ? {
            navigationRepair: {
              connectionId: text(navigationRepairData!.connectionId)!,
              beforeSelector: structuredClone(beforeSelector),
              currentSelector: structuredClone(currentSelector),
              attempts: Array.isArray(navigationRepairData?.attempts)
                ? structuredClone(navigationRepairData.attempts)
                : [],
            },
          }
        : {}),
    },
    evidence: {
      result: structuredClone(result.artifact),
      ...(failure ? { failure: structuredClone(failure) } : {}),
      frames,
    },
    lineage: {
      sourceRunId: run.id,
      ...(run.retryOf ? { retryOf: run.retryOf } : {}),
      priorAttempts: structuredClone(priorAttempts),
    },
    actions: actions({
      runId: run.id,
      checkId,
      retryAvailable,
      retargetSelector: currentSelector,
      acceptCurrentAvailable:
        Boolean(repairScreenId) && Boolean(text(record(failureData?.screenIdentity)?.fingerprint)),
      ...identity,
    }),
  };
}

export function listCampaignRepairTargets(runs: PersistedRun[]): CampaignRepairTarget[] {
  const attempts = new Map<string, CampaignRepairTarget["lineage"]["priorAttempts"]>();
  for (const candidate of runs) {
    const lineage = record(
      lastMatching(
        candidate.artifacts,
        (artifact) => artifact.kind === "campaign-check-repair-lineage",
      )?.data,
    );
    const sourceRunId = text(lineage?.sourceRunId);
    const sourceCheckId = text(lineage?.sourceCheckId);
    if (!sourceRunId || !sourceCheckId) continue;
    const key = repairTargetId(sourceRunId, sourceCheckId);
    const values = attempts.get(key) ?? [];
    values.push({
      runId: candidate.id,
      ...(text(lineage?.jobId) ? { jobId: text(lineage?.jobId) } : {}),
      status: candidate.status,
      createdAt: candidate.queuedAt,
    });
    attempts.set(key, values);
  }
  return runs
    .flatMap((run) =>
      resultArtifacts(run).flatMap(({ data }) => {
        const checkId = text(data.id);
        if (!checkId || (data.status !== "failed" && data.status !== "blocked")) return [];
        const target = buildCampaignRepairTarget(
          run,
          checkId,
          attempts.get(repairTargetId(run.id, checkId)) ?? [],
        );
        return target ? [target] : [];
      }),
    )
    .sort((left, right) => right.source.capturedAt - left.source.capturedAt);
}

export function summarizeCampaignRepairTarget(
  target: CampaignRepairTarget,
): CampaignRepairTargetSummary {
  return {
    schemaVersion: target.schemaVersion,
    id: target.id,
    status: target.status,
    defaultAction: target.defaultAction,
    source: structuredClone(target.source),
    error: target.observed.error,
    priorAttemptCount: target.lineage.priorAttempts.length,
  };
}

function assertReusableInputs(run: PersistedRun): void {
  const unavailable = Object.entries(run.resolvedInputs ?? {}).find(
    ([, value]) => value === PRIVATE_INPUT || value === REDACTED,
  );
  if (unavailable) {
    throw new Error(
      `This check used a private value for “${unavailable[0]}”. Provide it again before retrying.`,
    );
  }
}

/** Build a new one-check execution from frozen source data. No field in the
 * persisted source run is rewritten, and sibling campaign checks are omitted. */
export function campaignCheckRepairInput(
  run: PersistedRun,
  checkId: string,
  reconciliation?: CampaignRepairReconciliation,
): EnqueueJobInput {
  const target = buildCampaignRepairTarget(run, checkId, [], reconciliation);
  if (!target) throw new Error(`Run ${run.id} has no failed check ${checkId}`);
  assertReusableInputs(run);
  if (!run.recipeSnapshot || !run.recipeGraph) {
    throw new Error("This run predates frozen recipe data and cannot retry one check safely");
  }
  const plan = repairPlan(run, checkId, reconciliation);
  if (!plan) {
    throw new Error(
      `Frozen recipe has no verified live origin and warm executable path for check ${checkId}`,
    );
  }
  const rootId = `repair:${run.id}:${checkId}`;
  const { recovery: _recovery, ...warmCheck } = plan.checkStep.check;
  const checkpoint: Extract<RecipeStep, { kind: "expect-screen" }> = {
    ...structuredClone(plan.origin),
    timeoutMs: 0,
    recovery: undefined,
    repairCheckpoint: {
      sourceRunId: run.id,
      sourceCheckId: checkId,
      sourceInputDigest: run.inputDigest,
      ...(plan.transitionId ? { transitionId: plan.transitionId } : {}),
    },
  };
  const root: Recipe = {
    id: rootId,
    title: `${target.source.checkTitle} · selective repair`,
    description: `Retries only check ${checkId} from immutable run ${run.id}.`,
    source: "custom",
    steps: [
      checkpoint,
      {
        kind: "module",
        recipeId: plan.executableRecipeId,
        check: structuredClone(warmCheck),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const platform =
    run.platform === "android" || run.platform === "ios" || run.platform === "browser"
      ? run.platform
      : undefined;
  const targetId = run.serial?.trim();
  if (!platform || !targetId) {
    throw new Error("This run has no reusable target identity and cannot retry one check safely");
  }
  return {
    recipe: root.id,
    title: root.title,
    ...(platform === "browser"
      ? { targetKind: "browser", browserTargetId: targetId }
      : { targetKind: "device", serial: targetId, platform }),
    targetProfile: run.targetProfile,
    variables: structuredClone(run.resolvedInputs),
    recipeSnapshot: root,
    recipeGraph: {
      ...Object.fromEntries(
        Object.entries(structuredClone(plan.graph)).map(([id, recipe]) => [
          id,
          {
            ...recipe,
            steps: recipe.steps.map((step) =>
              step.kind === "expect-screen" && step.recovery
                ? { ...step, recovery: undefined }
                : step,
            ),
          },
        ]),
      ),
      [root.id]: root,
    },
    projectId: run.projectId,
    ownerId: run.ownerId,
    retryOf: run.id,
    artifacts: [
      {
        kind: "campaign-check-repair-lineage",
        capturedAt: Date.now(),
        data: {
          schemaVersion: 1,
          repairTargetId: target.id,
          sourceRunId: run.id,
          sourceCheckId: checkId,
          sourceInputDigest: run.inputDigest,
          sourceCapturedAt: target.source.capturedAt,
          ...(plan.sourceCheckStep.check.recovery?.recipeId
            ? { sourceRecoveryRecipeId: plan.sourceCheckStep.check.recovery.recipeId }
            : {}),
          ...(plan.reconciliation ? { reconciliation: structuredClone(plan.reconciliation) } : {}),
          checkpoint: {
            screenId: checkpoint.screenId,
            screenTitle: checkpoint.screenTitle,
            fingerprint: checkpoint.fingerprint,
            aliases: [...(checkpoint.aliases ?? [])],
            ...(plan.transitionId ? { transitionId: plan.transitionId } : {}),
            status: "required-live-proof",
          },
          execution: {
            recipeId: plan.executableRecipeId,
            mode: "warm-only",
            setupStepsReplayed: 0,
          },
        },
      },
    ],
  };
}
