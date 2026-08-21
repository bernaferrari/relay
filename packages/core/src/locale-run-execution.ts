/**
 * Durable execution boundary for a prepared locale matrix.
 *
 * Locale composition stays in locale-run.ts. This module owns the narrow
 * transition from immutable cases to jobs so multi-target callers can stage
 * every case before a lease or scheduler dispatch makes any device mutable.
 */
import { randomUUID } from "node:crypto";
import {
  assertExecutionTargetRef,
  type ExecutionTargetRef,
  type LocalAgentDeviceExecutionTargetRef,
  type TargetProfile,
} from "@relay/protocol";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { freezeRecipeGraph, readRecipe, type Recipe } from "./recipes.js";
import { redactRunMatrix, type PreparedRunMatrix } from "./run-matrix.js";
import { enqueueJob, prepareJobBatch, type EnqueueJobInput, type TestJob } from "./session.js";
import {
  completeTaughtLocaleScope,
  composeLocaleRunRecipes,
  prepareLocaleRunMatrix,
  type LocaleRunScope,
} from "./locale-run.js";

export type LocaleRunPreparationRequest = {
  recipeId: string;
  /** In-memory compiled body (App Map flow). Skips the recipe store. */
  compiledBody?: Recipe;
  compiledGraph?: Record<string, Recipe>;
  scope: LocaleRunScope;
  title?: string;
  projectId?: string;
  ownerId?: string;
  seed?: number;
  /** Stable target/Test/action identity used by later read-only duration
   * estimation. Generated locale wrapper ids are deliberately not suitable. */
  durationCohort?: { testId: string; action: string };
};

/** Legacy one-target request. New local campaign callers use a prepared run
 * plus one explicit target binding per case below. */
export type LocaleRunRequest = LocaleRunPreparationRequest & {
  targetId: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  targetProfile?: TargetProfile;
};

/** A case binding deliberately includes its generated index as well as the
 * visible locale. A restore can legitimately create the same locale twice,
 * so locale text alone is not a safe scheduling key. */
export type LocaleRunCaseTargetBinding = {
  caseIndex: number;
  locale: string;
  executionTarget: LocalAgentDeviceExecutionTargetRef;
  targetProfile?: TargetProfile;
};

export type PreparedLocaleRecipeRun = {
  id: string;
  recipeId: string;
  bodyRecipeId: string;
  title: string;
  createdAt: number;
  locales: string[];
  matrix: PreparedRunMatrix;
  composedRecipeId: string;
  /** Kept in core only; it is never a transport response. */
  recipeSnapshot: Recipe;
  recipeGraph: Record<string, Recipe>;
  projectId: string;
  ownerId?: string;
  durationCohort: { testId: string; action: string };
  cases: Array<{
    caseIndex: number;
    locale: string;
    variables: Record<string, string>;
  }>;
};

export type LocaleRunBatch = {
  id: string;
  recipeId: string;
  bodyRecipeId: string;
  title: string;
  createdAt: number;
  locales: string[];
  matrix: PreparedRunMatrix;
  jobs: TestJob[];
  composedRecipeId: string;
};

export type StagedLocaleRecipeRun = LocaleRunBatch &
  Pick<ReturnType<typeof prepareJobBatch>, "activate" | "dispatch" | "commit" | "rollback">;

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function durationCohortFor(input: {
  durationCohort?: { testId: string; action: string };
  bodyRecipeId: string;
}): { testId: string; action: string } {
  return {
    testId: requiredText(
      input.durationCohort?.testId ?? input.bodyRecipeId,
      "durationCohort testId",
    ),
    action: requiredText(
      input.durationCohort?.action ?? input.bodyRecipeId,
      "durationCohort action",
    ),
  };
}

function toBatch(prepared: PreparedLocaleRecipeRun, jobs: TestJob[]): LocaleRunBatch {
  return {
    id: prepared.id,
    recipeId: prepared.recipeId,
    bodyRecipeId: prepared.bodyRecipeId,
    title: prepared.title,
    createdAt: prepared.createdAt,
    locales: [...prepared.locales],
    matrix: structuredClone(prepared.matrix),
    jobs,
    composedRecipeId: prepared.composedRecipeId,
  };
}

/** Freeze locale composition and variables before any target is admitted. */
export async function prepareLocaleRecipeRun(
  input: LocaleRunPreparationRequest,
): Promise<PreparedLocaleRecipeRun> {
  const recipeId = requiredText(input.recipeId, "recipeId");
  const body = input.compiledBody ?? (await readRecipe(recipeId));
  if (!body) throw new Error(`recipe not found: ${recipeId}`);
  const scope = completeTaughtLocaleScope(input.scope);
  if (!scope.entryPath?.length && !scope.languagePath?.length) {
    throw new Error("Record how you open this list");
  }

  const id = randomUUID();
  const createdAt = Date.now();
  const preparedMatrix = await prepareLocaleRunMatrix(scope, input.seed);
  const { root, graph: seedGraph } = composeLocaleRunRecipes({ body, scope, batchId: id });
  const bodyGraph = await freezeRecipeGraph(body, input.compiledGraph ?? {});
  const recipeGraph: Record<string, Recipe> = {
    ...bodyGraph,
    ...seedGraph,
    [root.id]: root,
  };
  const operation = currentOperationContext();
  const projectId = input.projectId?.trim() || operation?.projectId || "default";
  const ownerId = input.ownerId?.trim() || operation?.actorId;
  const durationCohort = durationCohortFor({
    durationCohort: input.durationCohort,
    bodyRecipeId: body.id,
  });
  const matrix = redactRunMatrix(preparedMatrix.matrix, [
    {
      id: "locale",
      name: "locale",
      scope: "shared",
      source: "list",
      values: preparedMatrix.locales,
    },
  ]);

  return {
    id,
    recipeId: root.id,
    bodyRecipeId: body.id,
    title: input.title?.trim() || `${body.title} · locales`,
    createdAt,
    locales: [...preparedMatrix.locales],
    matrix,
    composedRecipeId: root.id,
    recipeSnapshot: root,
    recipeGraph,
    projectId,
    ...(ownerId ? { ownerId } : {}),
    durationCohort,
    cases: preparedMatrix.matrix.cases.map((item) => ({
      caseIndex: item.index,
      locale: item.values.locale ?? `case-${item.index + 1}`,
      variables: structuredClone(item.values),
    })),
  };
}

function targetInputFor(
  target: ExecutionTargetRef,
): Pick<
  EnqueueJobInput,
  "executionTarget" | "serial" | "platform" | "targetKind" | "browserTargetId"
> {
  assertExecutionTargetRef(target);
  if (target.kind === "local-device") {
    return {
      executionTarget: structuredClone(target),
      serial: target.targetId,
      platform: target.platform,
      targetKind: "device",
    };
  }
  if (target.kind === "local-browser") {
    return {
      executionTarget: structuredClone(target),
      targetKind: "browser",
      browserTargetId: target.targetId,
    };
  }
  throw new Error("Locale run target bindings require a configured local target driver");
}

function frozenInputsArtifact(input: {
  prepared: PreparedLocaleRecipeRun;
  caseIndex: number;
  locale: string;
  variables: Record<string, string>;
  executionTarget?: ExecutionTargetRef;
}) {
  const matrixCase = input.prepared.matrix.cases[input.caseIndex];
  return {
    kind: "frozen-inputs",
    capturedAt: input.prepared.matrix.createdAt,
    data: {
      matrixId: input.prepared.matrix.id,
      localeRunBatchId: input.prepared.id,
      seed: input.prepared.matrix.seed,
      caseIndex: input.caseIndex,
      caseCount: input.prepared.cases.length,
      locale: input.locale,
      values: matrixCase?.values ?? input.variables,
      provenance: matrixCase?.provenance,
      kind: "locale-matrix",
      // `campaign-duration-estimate` consumes this immutable projection when
      // it re-derives target/Test/action evidence from completed run manifests.
      durationCohort: structuredClone(input.prepared.durationCohort),
      ...(input.executionTarget
        ? {
            executionTarget: structuredClone(input.executionTarget),
            targetBinding: {
              schemaVersion: 1,
              caseIndex: input.caseIndex,
              locale: input.locale,
            },
          }
        : {}),
    },
  };
}

function enqueueInputForCase(input: {
  prepared: PreparedLocaleRecipeRun;
  item: PreparedLocaleRecipeRun["cases"][number];
  executionTarget?: ExecutionTargetRef;
  targetProfile?: TargetProfile;
  legacy?: Pick<LocaleRunRequest, "targetId" | "platform" | "targetKind" | "browserTargetId">;
}): EnqueueJobInput {
  const { prepared, item, executionTarget, targetProfile, legacy } = input;
  const targetInput = executionTarget
    ? targetInputFor(executionTarget)
    : {
        serial: legacy?.targetKind === "browser" ? undefined : legacy?.targetId,
        platform: legacy?.platform,
        targetKind: legacy?.targetKind ?? "device",
        browserTargetId: legacy?.browserTargetId,
      };
  return {
    recipe: prepared.recipeId,
    title: `${prepared.title} · ${item.locale}`,
    ...targetInput,
    ...(targetProfile ? { targetProfile: structuredClone(targetProfile) } : {}),
    variables: structuredClone(item.variables),
    recipeSnapshot: prepared.recipeSnapshot,
    recipeGraph: prepared.recipeGraph,
    batchId: prepared.id,
    caseIndex: item.caseIndex,
    caseCount: prepared.cases.length,
    projectId: prepared.projectId,
    ...(prepared.ownerId ? { ownerId: prepared.ownerId } : {}),
    artifacts: [
      frozenInputsArtifact({
        prepared,
        caseIndex: item.caseIndex,
        locale: item.locale,
        variables: item.variables,
        ...(executionTarget ? { executionTarget } : {}),
      }),
    ],
  };
}

function bindingsByCase(
  prepared: PreparedLocaleRecipeRun,
  bindings: readonly LocaleRunCaseTargetBinding[],
): Map<number, LocaleRunCaseTargetBinding> {
  if (bindings.length !== prepared.cases.length) {
    throw new Error(
      `Locale target bindings must cover every case (${prepared.cases.length} required, ${bindings.length} received)`,
    );
  }
  const expected = new Map(prepared.cases.map((item) => [item.caseIndex, item]));
  const result = new Map<number, LocaleRunCaseTargetBinding>();
  for (const rawBinding of bindings) {
    if (!Number.isSafeInteger(rawBinding.caseIndex) || rawBinding.caseIndex < 0) {
      throw new Error("Locale target binding caseIndex must be a non-negative integer");
    }
    const item = expected.get(rawBinding.caseIndex);
    if (!item)
      throw new Error(`Locale target binding case ${rawBinding.caseIndex} is not in this run`);
    if (result.has(rawBinding.caseIndex)) {
      throw new Error(`Locale target binding case ${rawBinding.caseIndex} is duplicated`);
    }
    if (typeof rawBinding.locale !== "string" || rawBinding.locale.trim() !== item.locale) {
      throw new Error(
        `Locale target binding case ${rawBinding.caseIndex} must name ${JSON.stringify(item.locale)}`,
      );
    }
    assertExecutionTargetRef(rawBinding.executionTarget);
    if (rawBinding.executionTarget.kind !== "local-device") {
      throw new Error("Locale target bindings support local Android and iOS devices only");
    }
    result.set(rawBinding.caseIndex, {
      caseIndex: rawBinding.caseIndex,
      locale: item.locale,
      executionTarget: structuredClone(rawBinding.executionTarget),
      ...(rawBinding.targetProfile
        ? { targetProfile: structuredClone(rawBinding.targetProfile) }
        : {}),
    });
  }
  return result;
}

/** Stage every explicit local-device case before campaign persistence and
 * lease finalization. The caller chooses when to activate/dispatch it. */
export function stagePreparedLocaleRecipeRun(input: {
  prepared: PreparedLocaleRecipeRun;
  targetBindings: readonly LocaleRunCaseTargetBinding[];
  operationContextForCase?: (binding: LocaleRunCaseTargetBinding) => OperationContext | undefined;
}): StagedLocaleRecipeRun {
  const bindings = bindingsByCase(input.prepared, input.targetBindings);
  const staged = prepareJobBatch(
    input.prepared.cases.map((item) => {
      const binding = bindings.get(item.caseIndex);
      if (!binding) throw new Error(`Locale case ${item.caseIndex} has no target binding`);
      const operationContext = input.operationContextForCase?.(binding);
      return {
        input: enqueueInputForCase({
          prepared: input.prepared,
          item,
          executionTarget: binding.executionTarget,
          targetProfile: binding.targetProfile,
        }),
        ...(operationContext ? { operationContext } : {}),
      };
    }),
  );
  return {
    ...toBatch(input.prepared, staged.jobs),
    activate: staged.activate,
    dispatch: staged.dispatch,
    commit: staged.commit,
    rollback: staged.rollback,
  };
}

/** Compatibility entry point for the historic one-target locale workflow.
 * It preserves the old target fields and should not be used to claim local
 * multi-device deadline capacity. */
export async function startLocaleRecipeRun(input: LocaleRunRequest): Promise<LocaleRunBatch> {
  const targetId = requiredText(input.targetId, "targetId");
  const prepared = await prepareLocaleRecipeRun(input);
  const jobs = prepared.cases.map((item) =>
    enqueueJob(
      enqueueInputForCase({
        prepared,
        item,
        targetProfile: input.targetProfile,
        legacy: {
          targetId,
          platform: input.platform,
          targetKind: input.targetKind,
          browserTargetId: input.browserTargetId,
        },
      }),
    ),
  );
  return toBatch(prepared, jobs);
}
