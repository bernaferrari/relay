import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  artifactDigestForProof,
  bindRegisteredWebDeploymentToProof,
  canonicalSha256,
  compileAppMapScenarioTest,
  compileExecutionRisk,
  compileVerificationPlan,
  findWorkspaceRoot,
  inspectWorkspaceChange,
  listBuilds,
  preflightRegisteredBuild,
  proofStartInputFromVerificationPlan,
  readAppMap,
  verificationCellId,
} from "@relay/core";
import {
  CHANGE_SIGNAL_KINDS,
  VERIFY_CHANGE_POLICY,
  changeVerificationBuildSchema,
  changeVerificationChangeSchema,
  changeVerificationPolicySchema,
  frozenVerificationTargetCaseSchema,
  journeyAssociationSchema,
  verificationCellSchema,
  verificationPlanSchema,
  type OperationInput,
  type VerificationPlan,
} from "@relay/protocol";

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const CONFIG_FIELDS = new Set([
  "schemaVersion",
  "repository",
  "pullRequest",
  "agentClaim",
  "changed",
  "associations",
  "builds",
  "targetCases",
  "cells",
  "pilotCellId",
  "policy",
  "maxCases",
  "maxDurationMs",
]);

type ReviewedPreparationConfig = {
  repository?: string;
  pullRequest?: number;
  agentClaim?: unknown;
  changed: Partial<Record<(typeof CHANGE_SIGNAL_KINDS)[number], readonly string[]>>;
  associations: readonly unknown[];
  builds: readonly unknown[];
  targetCases: readonly unknown[];
  cells?: readonly unknown[];
  pilotCellId?: string;
  policy: unknown;
  maxCases?: number;
  maxDurationMs?: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedList(value: unknown, label: string, max: number): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${label} must be an array of at most ${max} entries`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${label} must be a positive integer no greater than ${max}`);
  }
  return Number(value);
}

async function readReviewedConfiguration(root: string): Promise<{
  config: ReviewedPreparationConfig;
  blockers: string[];
}> {
  const path = join(root, ".relay", "change-proof.json");
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("is not a regular file");
    if (info.size > MAX_CONFIG_BYTES) throw new Error("exceeds the 4 MiB limit");
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
      throw new Error("exceeds the 4 MiB limit");
    }
    const input = record(JSON.parse(raw) as unknown, ".relay/change-proof.json");
    for (const field of Object.keys(input)) {
      if (!CONFIG_FIELDS.has(field)) {
        throw new Error(`.relay/change-proof.json has unknown field ${field}`);
      }
    }
    if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
      throw new Error(".relay/change-proof.json schemaVersion must be 1");
    }
    const changedInput = input.changed === undefined ? {} : record(input.changed, "changed");
    const changed: ReviewedPreparationConfig["changed"] = {};
    for (const field of Object.keys(changedInput)) {
      if (!(CHANGE_SIGNAL_KINDS as readonly string[]).includes(field)) {
        throw new Error(`.relay/change-proof.json changed has unknown field ${field}`);
      }
    }
    for (const kind of CHANGE_SIGNAL_KINDS) {
      const values = boundedList(changedInput[kind], `changed.${kind}`, 512);
      if (
        values.some((value) => typeof value !== "string" || !value.trim() || value.length > 1_024)
      ) {
        throw new Error(`changed.${kind} must contain bounded non-empty strings`);
      }
      if (values.length) changed[kind] = values as readonly string[];
    }
    const repository =
      input.repository === undefined
        ? undefined
        : typeof input.repository === "string" && input.repository.trim()
          ? input.repository.trim()
          : (() => {
              throw new Error("repository must be a non-empty string");
            })();
    const pilotCellId =
      input.pilotCellId === undefined
        ? undefined
        : typeof input.pilotCellId === "string" && input.pilotCellId.trim()
          ? input.pilotCellId.trim()
          : (() => {
              throw new Error("pilotCellId must be a non-empty string");
            })();
    return {
      config: {
        ...(repository ? { repository } : {}),
        ...(positiveInteger(input.pullRequest, "pullRequest", 2_147_483_647)
          ? { pullRequest: Number(input.pullRequest) }
          : {}),
        ...(input.agentClaim === undefined ? {} : { agentClaim: input.agentClaim }),
        changed,
        associations: boundedList(input.associations, "associations", 2_048).map((value) =>
          journeyAssociationSchema.parse(value),
        ),
        builds: boundedList(input.builds, "builds", 32).map((value) =>
          changeVerificationBuildSchema.parse(value),
        ),
        targetCases: boundedList(input.targetCases, "targetCases", 250).map((value) =>
          frozenVerificationTargetCaseSchema.parse(value),
        ),
        ...(input.cells === undefined
          ? {}
          : {
              cells: boundedList(input.cells, "cells", 1_000).map((value) =>
                verificationCellSchema.parse(value),
              ),
            }),
        ...(pilotCellId ? { pilotCellId } : {}),
        policy: changeVerificationPolicySchema.parse(input.policy ?? VERIFY_CHANGE_POLICY),
        ...(positiveInteger(input.maxCases, "maxCases", 10_000)
          ? { maxCases: Number(input.maxCases) }
          : {}),
        ...(positiveInteger(input.maxDurationMs, "maxDurationMs", 86_400_000)
          ? { maxDurationMs: Number(input.maxDurationMs) }
          : {}),
      },
      blockers: [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      config: {
        changed: {},
        associations: [],
        builds: [],
        targetCases: [],
        policy: VERIFY_CHANGE_POLICY,
      },
      blockers: [
        "Add reviewed journey, target, and build policy in .relay/change-proof.json before approval.",
      ],
    };
  }
}

async function verifiedBuilds(input: {
  projectId: string;
  testedSha: string;
  configured: readonly unknown[];
  buildIds?: readonly string[];
}): Promise<{ builds: VerificationPlan["builds"]; blockers: string[] }> {
  const registered = await listBuilds(input.projectId);
  const selected = input.configured
    .map((value) => changeVerificationBuildSchema.parse(value))
    .filter((build) => !input.buildIds || input.buildIds.includes(build.id));
  const builds: VerificationPlan["builds"][number][] = [];
  const blockers: string[] = [];
  for (const build of selected) {
    const source = registered.find(({ id }) => id === build.id);
    if (!source || source.status !== "ready" || source.sourceSha !== input.testedSha) {
      blockers.push(`Build ${build.id} is not a ready registered build for the exact tested SHA.`);
      continue;
    }
    if (build.platform === "web") {
      if (source.platform !== "web") {
        blockers.push(`Build ${build.id} is not registered as a web deployment.`);
        continue;
      }
      try {
        const bound = bindRegisteredWebDeploymentToProof({
          build: source,
          changeTestedSha: input.testedSha,
        });
        if (
          bound.artifactDigest !== build.artifactDigest ||
          bound.sourceSha !== build.sourceSha ||
          bound.configuration !== build.configuration ||
          bound.environmentRevision !== build.environmentRevision
        ) {
          blockers.push(`Build ${build.id} no longer matches its reviewed deployment identity.`);
          continue;
        }
        builds.push(bound);
      } catch (error) {
        blockers.push(
          `Build ${build.id} failed provider-verified web deployment binding: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }
    if (source.platform !== build.platform) {
      blockers.push(
        `Build ${build.id} is registered for ${source.platform}, not ${build.platform}.`,
      );
      continue;
    }
    const preflight = await preflightRegisteredBuild(source);
    if (!preflight.ok || !preflight.artifact) {
      blockers.push(`Build ${build.id} failed artifact preflight.`);
      continue;
    }
    const digest = await artifactDigestForProof(preflight.artifact.path);
    if (digest !== build.artifactDigest) {
      blockers.push(`Build ${build.id} no longer matches its reviewed artifact digest.`);
      continue;
    }
    builds.push(build);
  }
  if (input.buildIds) {
    for (const id of input.buildIds) {
      if (!selected.some((build) => build.id === id)) {
        blockers.push(`Build ${id} is not part of the reviewed repository configuration.`);
      }
    }
  }
  return { builds, blockers };
}

async function freezeAppMapRevisions(
  projectId: string,
  plan: VerificationPlan,
): Promise<{ plan: VerificationPlan; blockers: string[] }> {
  const revisions = new Map<string, number>();
  const appMaps = new Map<string, NonNullable<Awaited<ReturnType<typeof readAppMap>>>>();
  const blockers: string[] = [];
  for (const journey of plan.selection.affectedJourneys) {
    const appMap = await readAppMap(projectId, journey.appMapId);
    if (!appMap || !appMap.tests[journey.testId]) {
      blockers.push(
        `Reviewed journey ${journey.appMapId}/${journey.testId} is not present in the current App Map.`,
      );
      continue;
    }
    appMaps.set(journey.appMapId, appMap);
    revisions.set(journey.appMapId, appMap.revision);
  }
  const cells = [] as NonNullable<VerificationPlan["selection"]["cells"]>[number][];
  for (const cell of plan.selection.cells ?? []) {
    const appMapRevision = revisions.get(cell.journey.appMapId);
    const appMap = appMaps.get(cell.journey.appMapId);
    const targetCase = plan.selection.targetCases.find(({ id }) => id === cell.targetCaseId);
    if (!appMapRevision || !appMap || !targetCase) {
      cells.push(cell);
      continue;
    }
    let executionRisk;
    try {
      const test = appMap.tests[cell.journey.testId];
      if (!test) throw new Error("Test is missing");
      const compiled = compileAppMapScenarioTest(appMap, test, {
        runtimeTargetProfile: targetCase.targetProfile,
      }).plan;
      executionRisk = compileExecutionRisk({ kind: "compiled-test", test: compiled });
    } catch (error) {
      blockers.push(
        `Verification Cell ${cell.id} could not freeze execution authority: ${error instanceof Error ? error.message : String(error)}`,
      );
      cells.push(cell);
      continue;
    }
    cells.push({
      ...cell,
      id: verificationCellId({
        ...cell.journey,
        appMapRevision,
        targetCaseId: cell.targetCaseId,
        buildId: cell.buildId,
      }),
      journey: { ...cell.journey, appMapRevision },
      executionRisk,
      executionRiskDigest: canonicalSha256(executionRisk),
      cleanupRequired: executionRisk.cleanupRequired,
    });
  }
  const idMap = new Map(
    (plan.selection.cells ?? []).map((cell, index) => [cell.id, cells[index]?.id ?? cell.id]),
  );
  const pilotCellId = plan.selection.pilotCellId
    ? idMap.get(plan.selection.pilotCellId)
    : undefined;
  return {
    plan: verificationPlanSchema.parse({
      ...plan,
      status: blockers.length ? "needs-review" : plan.status,
      selection: {
        ...plan.selection,
        affectedJourneys: plan.selection.affectedJourneys.map((journey) => ({
          ...journey,
          ...(revisions.has(journey.appMapId)
            ? { appMapRevision: revisions.get(journey.appMapId)! }
            : {}),
        })),
        ...(cells.length ? { cells } : {}),
        ...(pilotCellId ? { pilotCellId } : {}),
      },
      ...(pilotCellId ? { pilotCellId } : {}),
      expansion: {
        ...plan.expansion,
        ...(plan.expansion.cellIds
          ? { cellIds: plan.expansion.cellIds.map((id) => idMap.get(id) ?? id) }
          : {}),
      },
    }),
    blockers,
  };
}

export async function prepareCurrentChangeVerification(input: {
  projectId: string;
  request: OperationInput<"proof.prepare">;
}): Promise<{ plan: VerificationPlan; blockers: string[] }> {
  const root = findWorkspaceRoot();
  const change = await inspectWorkspaceChange({
    startPath: root,
    ...(input.request.baseRef ? { baseRef: input.request.baseRef } : {}),
  });
  if (!change.readyForProof || !change.repository || !change.changeRef || !change.base) {
    throw new Error(change.blockers.join(" ") || "The active workspace change is not ready.");
  }
  if (change.changedFiles.length !== change.changedFileCount) {
    throw new Error("The active change exceeds the bounded Proof preparation file list.");
  }
  const reviewed = await readReviewedConfiguration(root);
  if (reviewed.config.repository && reviewed.config.repository !== change.repository) {
    throw new Error("The reviewed Proof configuration belongs to another repository.");
  }
  const policy = changeVerificationPolicySchema.parse(
    input.request.policy ?? reviewed.config.policy ?? VERIFY_CHANGE_POLICY,
  );
  const testedSha = change.changeRef.testedSha;
  const exactChange = changeVerificationChangeSchema.parse({
    repository: change.repository,
    baseSha: change.changeRef.mergeBaseSha,
    headSha: testedSha,
    ...change.changeRef,
    ...((input.request.pullRequest ?? reviewed.config.pullRequest)
      ? { pullRequest: input.request.pullRequest ?? reviewed.config.pullRequest }
      : {}),
    ...((input.request.agentClaim ?? reviewed.config.agentClaim)
      ? { agentClaim: input.request.agentClaim ?? reviewed.config.agentClaim }
      : {}),
  });
  const buildResult = await verifiedBuilds({
    projectId: input.projectId,
    testedSha,
    configured: reviewed.config.builds,
    ...(input.request.buildIds ? { buildIds: input.request.buildIds } : {}),
  });
  const targetCases = reviewed.config.targetCases
    .map((value) => frozenVerificationTargetCaseSchema.parse(value))
    .filter(
      (target) =>
        !input.request.targetIds ||
        input.request.targetIds.includes(target.executionTarget.targetId),
    );
  const compiled = compileVerificationPlan({
    change: exactChange,
    changed: {
      files: change.changedFiles,
      symbols: [...(reviewed.config.changed.symbols ?? [])],
      routes: [...(reviewed.config.changed.routes ?? [])],
      resources: [...(reviewed.config.changed.resources ?? [])],
      localizationKeys: [...(reviewed.config.changed.localizationKeys ?? [])],
      apiContracts: [...(reviewed.config.changed.apiContracts ?? [])],
    },
    associations: reviewed.config.associations,
    builds: buildResult.builds,
    targetCases,
    ...(reviewed.config.cells ? { cells: reviewed.config.cells } : {}),
    ...(reviewed.config.pilotCellId ? { pilotCellId: reviewed.config.pilotCellId } : {}),
    policy,
    ...(reviewed.config.maxCases ? { maxCases: reviewed.config.maxCases } : {}),
    ...(reviewed.config.maxDurationMs ? { maxDurationMs: reviewed.config.maxDurationMs } : {}),
  });
  const frozen = await freezeAppMapRevisions(input.projectId, compiled);
  const blockers = [...reviewed.blockers, ...buildResult.blockers, ...frozen.blockers];
  const plan = blockers.length
    ? verificationPlanSchema.parse({
        ...frozen.plan,
        status: frozen.plan.builds.length ? "needs-review" : "awaiting-build",
      })
    : frozen.plan;
  return { plan, blockers: [...new Set(blockers)] };
}

export function proofPreparationStartInput(plan: VerificationPlan) {
  return proofStartInputFromVerificationPlan(plan);
}
