import type {
  CampaignRepairAction,
  CampaignRepairTarget,
  CampaignRepairTargetSummary,
} from "@relay/protocol";
import { PRIVATE_INPUT } from "./private-inputs.js";
import { REDACTED } from "./redaction.js";
import type { PersistedRun } from "./runs.js";
import type { EnqueueJobInput } from "./session-contract.js";
import type { Recipe, RecipeStep } from "./recipes.js";

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

function lastMatching<T>(values: T[], predicate: (value: T) => boolean): T | undefined {
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
  return run.artifacts.flatMap((artifact) => {
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

function planIdentity(run: PersistedRun): {
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
        "Create a lineage-linked run containing only the canonical setup and this failed check.",
      operationId: "run.repair.retry",
      fixedInput: { runId: input.runId, checkId: input.checkId },
      ...(!input.retryAvailable
        ? { unavailableReason: "The source run has no frozen executable recipe for this check." }
        : {}),
    },
    {
      kind: "accept-current-proposal",
      label: "Accept current via proposal",
      available: false,
      mutation: "reviewed-proposal",
      description:
        "Accepting changed product behavior must be a reviewable baseline/map diff, never a direct run mutation.",
      unavailableReason:
        "Relay has not derived a reversible baseline diff from this evidence. Inspect it and create a reviewed proposal first.",
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
      available: false,
      mutation: "reviewed-proposal",
      description:
        "Disabling coverage requires an explicit, reversible Test policy diff and review.",
      unavailableReason:
        "The Test contract has no reversible disabled-step policy yet; Relay will not silently remove the check.",
      proposalRequirements,
    },
  ];
}

export function buildCampaignRepairTarget(
  run: PersistedRun,
  checkId: string,
  priorAttempts: CampaignRepairTarget["lineage"]["priorAttempts"] = [],
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
  const plan = planIdentity(run);
  const frames = run.frames.flatMap((frame, index) =>
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
  const retryAvailable = Boolean(frozenStep && run.recipeSnapshot && run.recipeGraph && recipeId);
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
      ...plan,
    },
    expected: {
      ...(recipeId ? { recipeId } : {}),
      ...(expectedScreenId(recipe) ? { screenId: expectedScreenId(recipe) } : {}),
      ...(text(selectiveRepair?.groupId) || frozenStep?.check.recovery?.groupId
        ? { groupId: text(selectiveRepair?.groupId) ?? frozenStep?.check.recovery?.groupId }
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
      ...plan,
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
  const unavailable = Object.entries(run.resolvedInputs).find(
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
export function campaignCheckRepairInput(run: PersistedRun, checkId: string): EnqueueJobInput {
  const target = buildCampaignRepairTarget(run, checkId);
  if (!target) throw new Error(`Run ${run.id} has no failed check ${checkId}`);
  assertReusableInputs(run);
  if (!run.recipeSnapshot || !run.recipeGraph) {
    throw new Error("This run predates frozen recipe data and cannot retry one check safely");
  }
  const checkStep = frozenCheckStep(run, checkId);
  if (!checkStep) throw new Error(`Frozen recipe has no check ${checkId}`);
  const recoveryRecipeId = checkStep.check.recovery?.recipeId;
  const moduleRecipeId = checkStep.kind === "module" ? checkStep.recipeId : undefined;
  const executableRecipeId = recoveryRecipeId ?? moduleRecipeId;
  if (!executableRecipeId || !run.recipeGraph[executableRecipeId]) {
    throw new Error(`Frozen recipe has no canonical executable path for check ${checkId}`);
  }
  const rootCheckIndex = run.recipeSnapshot.steps.findIndex((step) => step.check?.id === checkId);
  const setupSteps =
    rootCheckIndex < 0
      ? []
      : run.recipeSnapshot.steps.slice(0, rootCheckIndex).filter((step) => !step.check);
  const rootId = `repair:${run.id}:${checkId}`;
  const root: Recipe = {
    id: rootId,
    title: `${target.source.checkTitle} · selective repair`,
    description: `Retries only check ${checkId} from immutable run ${run.id}.`,
    source: "custom",
    steps: recoveryRecipeId
      ? [
          {
            kind: "module",
            recipeId: recoveryRecipeId,
            check: { id: checkId, title: target.source.checkTitle },
          },
        ]
      : [...structuredClone(setupSteps), structuredClone(checkStep)],
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
    recipeGraph: { ...structuredClone(run.recipeGraph), [root.id]: root },
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
        },
      },
    ],
  };
}
