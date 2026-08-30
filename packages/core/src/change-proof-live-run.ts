import {
  changeProofCaseResultSchema,
  executionRiskSchema,
  parseChangeVerification,
  changeTestedSha,
  type ExecutionRisk,
  type ChangeProofCaseResult,
  type ChangeVerification,
} from "@relay/protocol";
import { decideChangeVerification } from "./change-proof-decision.js";
import {
  appMapRuntimeTargetProfileFromSaved,
  sameAppMapRuntimeTargetProfile,
} from "./app-map-runtime-target-profile.js";
import { parseCanonicalAppMapTestPlan } from "./app-map-test-execution-intent.js";
import type { PersistedRun } from "./runs.js";
import { analyzeTracePack, exportTracePack } from "./trace-pack.js";
import { canonicalSha256 } from "./canonical-json.js";
import { compileExecutionRisk } from "./execution-risk-compiler.js";

export type ChangeProofRunCase = Readonly<{
  cellId: string;
  appMapId: string;
  testId: string;
  appMapRevision: number;
  targetCaseId: string;
  buildId: string;
}>;

type FrozenVerificationCell = NonNullable<ChangeVerification["selection"]["cells"]>[number];

/** Validate the risk authority frozen into one Verification Cell. The
 * structured risk and its digest are both required for executable Proofs so
 * a caller cannot replace a prohibited Test with an unlabelled safe default. */
export function frozenCellExecutionRisk(cell: FrozenVerificationCell): ExecutionRisk {
  const risk = cell.executionRisk;
  if (!risk || !cell.executionRiskDigest) {
    throw new Error(`Verification Cell ${cell.id} has no frozen execution-risk authority`);
  }
  const parsed = executionRiskSchema.parse(risk);
  if (canonicalSha256(parsed) !== cell.executionRiskDigest) {
    throw new Error(`Verification Cell ${cell.id} execution-risk digest does not match`);
  }
  if (parsed.cleanupRequired !== cell.cleanupRequired) {
    throw new Error(`Verification Cell ${cell.id} cleanup authority disagrees with execution risk`);
  }
  return parsed;
}

/** The first safe execution slice deliberately admits only Tests whose
 * frozen risk needs no confirmation and has no external mutation effect. */
export function assertSafeCellExecutionAuthority(cell: FrozenVerificationCell): ExecutionRisk {
  if (!cell.evidencePolicyDigest) {
    throw new Error(`Verification Cell ${cell.id} has no frozen evidence-policy authority`);
  }
  const risk = frozenCellExecutionRisk(cell);
  if (risk.level !== "safe" || risk.confirmation !== "none") {
    throw new Error(
      `Verification Cell ${cell.id} requires ${risk.level}/${risk.confirmation} authority; only safe/none Proof execution is currently supported`,
    );
  }
  return risk;
}

function platformForTargetCase(
  item: ChangeVerification["selection"]["targetCases"][number],
): ChangeVerification["builds"][number]["platform"] {
  return item.executionTarget.platform === "browser" ? "web" : item.executionTarget.platform;
}

/** Return the exact frozen cells. The explicit pilot runs first, then every
 * remaining required cell, then advisory coverage. Advisory failures can add
 * residual risk but never prevent a later required cell from running. */
export function changeProofRequiredRunCases(value: unknown): ChangeProofRunCase[] {
  const proof = parseChangeVerification(value);
  const cells = proof.selection.cells;
  if (!cells?.length) throw new Error("Proof has no frozen Verification Cells.");
  const pilot = cells.find(({ id }) => id === proof.selection.pilotCellId);
  if (!pilot || pilot.requirement !== "required") {
    throw new Error("Proof has no explicit policy-required pilot Verification Cell.");
  }
  const orderedCells = [
    pilot,
    ...cells.filter(({ id, requirement }) => id !== pilot.id && requirement === "required"),
    ...cells.filter(({ requirement }) => requirement === "advisory"),
  ];
  const targetCases = new Map(
    proof.selection.targetCases.map((targetCase) => [targetCase.id, targetCase]),
  );
  const builds = new Map(proof.builds.map((build) => [build.id, build]));
  return orderedCells.map((cell) => {
    const journey = proof.selection.affectedJourneys.find(
      (candidate) =>
        candidate.appMapId === cell.journey.appMapId &&
        candidate.testId === cell.journey.testId &&
        candidate.appMapRevision === cell.journey.appMapRevision,
    );
    if (!journey || journey.appMapRevision === undefined) {
      throw new Error(
        `Verification Cell ${cell.id} has no frozen App Map revision for ${cell.journey.appMapId}/${cell.journey.testId}.`,
      );
    }
    const targetCase = targetCases.get(cell.targetCaseId);
    const build = builds.get(cell.buildId);
    if (!targetCase || !build) {
      throw new Error(`Verification Cell ${cell.id} references a missing frozen target or build.`);
    }
    const expectedPlatform = platformForTargetCase(targetCase);
    if (build.platform !== expectedPlatform || build.sourceSha !== changeTestedSha(proof.change)) {
      throw new Error(`Verification Cell ${cell.id} does not bind a compatible exact build.`);
    }
    assertSafeCellExecutionAuthority(cell);
    return {
      cellId: cell.id,
      appMapId: journey.appMapId,
      testId: journey.testId,
      appMapRevision: journey.appMapRevision,
      targetCaseId: targetCase.id,
      buildId: build.id,
    };
  });
}

function planForRun(run: PersistedRun): ReturnType<typeof parseCanonicalAppMapTestPlan> {
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "app-map-test-plan") continue;
    const plan = parseCanonicalAppMapTestPlan(artifact.data);
    if (plan) return plan;
  }
  return undefined;
}

type ExpectedCleanupCheck = {
  checkId: string;
  recipeId: string;
  terminalScreenId: string;
};

function expectedCleanupChecks(run: PersistedRun): ExpectedCleanupCheck[] | undefined {
  const plan = planForRun(run);
  const root = plan?.recipes[plan.rootRecipeId] ?? run.recipeSnapshot;
  if (!root) return undefined;
  const checks = root.steps.flatMap((step) =>
    step.check?.cleanup
      ? [
          {
            checkId: step.check.id,
            recipeId: step.check.cleanup.recipeId,
            terminalScreenId: step.check.cleanup.terminalScreenId,
          },
        ]
      : [],
  );
  return new Set(checks.map(({ checkId }) => checkId)).size === checks.length ? checks : undefined;
}

function targetCaseForRun(
  proof: ChangeVerification,
  run: PersistedRun,
): ChangeVerification["selection"]["targetCases"][number] {
  const matching = proof.selection.targetCases.filter((targetCase) => {
    if (!run.targetProfile) return false;
    if (
      !sameAppMapRuntimeTargetProfile(
        appMapRuntimeTargetProfileFromSaved(run.targetProfile),
        appMapRuntimeTargetProfileFromSaved(targetCase.targetProfile),
      )
    ) {
      return false;
    }
    if (
      run.executionTarget &&
      (run.executionTarget.kind !== targetCase.executionTarget.kind ||
        run.executionTarget.targetId !== targetCase.executionTarget.targetId ||
        run.executionTarget.platform !== targetCase.executionTarget.platform ||
        run.executionTarget.provider.key !== targetCase.executionTarget.provider.key ||
        run.executionTarget.provider.scope !== targetCase.executionTarget.provider.scope)
    ) {
      return false;
    }
    // Some matrix dimensions are already frozen into the target profile
    // (locale, engine, viewport) and therefore need not also be recipe
    // inputs. When a Run does carry a dimension, it must agree exactly.
    return Object.entries(targetCase.dimensions).every(
      ([dimension, value]) =>
        run.resolvedInputs[dimension] === undefined || run.resolvedInputs[dimension] === value,
    );
  });
  if (matching.length !== 1) {
    throw new Error(
      `Run ${run.id} must bind exactly one frozen Proof target case; found ${matching.length}.`,
    );
  }
  return matching[0]!;
}

function buildForRun(
  proof: ChangeVerification,
  run: PersistedRun,
): ChangeVerification["builds"][number] {
  const revision = run.sourceRevision;
  const matching = proof.builds.filter(
    (build) =>
      (!revision?.buildId || build.id === revision.buildId) &&
      build.sourceSha === revision?.sha &&
      build.artifactDigest === revision.artifactDigest,
  );
  if (matching.length !== 1) {
    throw new Error(
      `Run ${run.id} must bind exactly one frozen Proof build; found ${matching.length}.`,
    );
  }
  return matching[0]!;
}

/** Resolve a persisted Run to the one frozen Verification Cell it claims to
 * execute. This deliberately only proves identity, not outcome or evidence;
 * callers that need a result must still use
 * `changeProofCaseResultFromPersistedRun`. Returning `undefined` makes an
 * unrelated/manual Run harmless to execution progress rather than allowing
 * its position in `proof.runIds` to skip a cell. */
export function changeProofCellIdFromPersistedRun(input: {
  proof: unknown;
  run: PersistedRun;
}): string | undefined {
  try {
    const proof = parseChangeVerification(input.proof);
    const run = input.run;
    const runPlan = planForRun(run);
    if (!runPlan) return undefined;
    const targetCase = targetCaseForRun(proof, run);
    const build = buildForRun(proof, run);
    const identity = {
      appMapId: runPlan.appMapId,
      testId: runPlan.test.id,
      appMapRevision: runPlan.appMapRevision,
    };
    const matchingCells =
      proof.selection.cells?.filter(
        (candidate) =>
          candidate.journey.appMapId === identity.appMapId &&
          candidate.journey.testId === identity.testId &&
          candidate.journey.appMapRevision === identity.appMapRevision &&
          candidate.targetCaseId === targetCase.id &&
          candidate.buildId === build.id &&
          Object.entries(candidate.dimensions).every(
            ([dimension, value]) =>
              targetCase.dimensions[dimension] === value || run.resolvedInputs[dimension] === value,
          ),
      ) ?? [];
    return matchingCells.length === 1 ? matchingCells[0]!.id : undefined;
  } catch {
    return undefined;
  }
}

function assertBuildProvenanceReceipt(
  run: PersistedRun,
  targetCase: ChangeVerification["selection"]["targetCases"][number],
  build: ChangeVerification["builds"][number],
): void {
  if (!run.sourceRevision?.buildId) return;
  const artifact = run.artifacts.find((item) => item.kind === "proof-build-provenance");
  const receipt = artifact?.data;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error(`Run ${run.id} has no target-specific Proof build provenance receipt.`);
  }
  const value = receipt as Record<string, unknown>;
  const target = value.target;
  const observation = value.observation;
  const targetRecord: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target)
      ? (target as Record<string, unknown>)
      : {};
  const observationRecord =
    observation && typeof observation === "object" && !Array.isArray(observation)
      ? (observation as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (
    value.schemaVersion !== 1 ||
    value.buildId !== build.id ||
    value.artifactDigest !== build.artifactDigest ||
    targetRecord.id !== targetCase.executionTarget.targetId ||
    targetRecord.platform !==
      (targetCase.executionTarget.platform === "browser"
        ? "browser"
        : targetCase.executionTarget.platform) ||
    observationRecord.status !== "verified" ||
    observationRecord.artifactDigest !== build.artifactDigest
  ) {
    throw new Error(
      `Run ${run.id} has target-specific Proof build provenance that does not match.`,
    );
  }
}

function cleanupOutcome(
  run: PersistedRun,
  cleanupRequired: boolean,
): ChangeProofCaseResult["cleanup"] {
  if (!cleanupRequired) return "not-required";
  const cleanup = run.artifacts.filter((artifact) => artifact.kind === "campaign-check-cleanup");
  if (!cleanup.length) return "unproved";
  const expected = expectedCleanupChecks(run);
  if (!expected || cleanup.length !== expected.length) return "unproved";
  for (const check of expected) {
    const matches = cleanup.filter((artifact) => {
      const data = artifact.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      const value = data as {
        checkId?: unknown;
        recipeId?: unknown;
        terminalScreenId?: unknown;
      };
      return (
        value.checkId === check.checkId &&
        value.recipeId === check.recipeId &&
        value.terminalScreenId === check.terminalScreenId
      );
    });
    if (matches.length !== 1) return "unproved";
    const data = matches[0]!.data;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      (data as { status?: unknown }).status !== "passed"
    ) {
      return "failed";
    }
  }
  return "restored";
}

/** Derive one case fact only from the immutable Run and its verified
 * TracePack. The caller supplies no verdict, selector status, or evidence
 * completeness and therefore cannot forge a green Proof. */
export async function changeProofCaseResultFromPersistedRun(input: {
  proof: unknown;
  run: PersistedRun;
}): Promise<ChangeProofCaseResult> {
  const proof = parseChangeVerification(input.proof);
  const run = input.run;
  const runPlan = planForRun(run);
  if (!runPlan) throw new Error(`Run ${run.id} has no frozen App Map Test identity.`);
  const identity = {
    appMapId: runPlan.appMapId,
    testId: runPlan.test.id,
    appMapRevision: runPlan.appMapRevision,
  };
  if (
    !proof.selection.affectedJourneys.some(
      (journey) =>
        journey.appMapId === identity.appMapId &&
        journey.testId === identity.testId &&
        journey.appMapRevision !== undefined &&
        journey.appMapRevision === identity.appMapRevision,
    )
  ) {
    throw new Error(
      `Run ${run.id} does not use the exact frozen App Map revision for this Proof's affected journey.`,
    );
  }
  const targetCase = targetCaseForRun(proof, run);
  const build = buildForRun(proof, run);
  assertBuildProvenanceReceipt(run, targetCase, build);
  const cellId = changeProofCellIdFromPersistedRun({ proof, run });
  if (!cellId) {
    throw new Error(`Run ${run.id} must bind exactly one frozen Verification Cell; found none.`);
  }
  const cell = proof.selection.cells!.find(({ id }) => id === cellId)!;
  frozenCellExecutionRisk(cell);
  const runRisk = compileExecutionRisk({ kind: "compiled-test", test: runPlan });
  if (canonicalSha256(runRisk) !== cell.executionRiskDigest) {
    throw new Error(
      `Run ${run.id} execution risk does not match the frozen authority for Verification Cell ${cell.id}`,
    );
  }
  if (runRisk.level !== "safe" || runRisk.confirmation !== "none") {
    throw new Error(
      `Run ${run.id} requires ${runRisk.level}/${runRisk.confirmation} authority; only safe/none Proof execution is currently supported`,
    );
  }
  const pack = await exportTracePack(run);
  const analysis = analyzeTracePack(pack);
  const recomputed = analysis.recomputed ?? [];
  const recordedTransitionProof = analysis.proved.some(
    ({ code }) => code === "RECORDED_TRANSITION_PROOF",
  );
  const selectorResolution: ChangeProofCaseResult["selectorResolution"] = recomputed.some(
    ({ status }) => status === "changed" || status === "blocked",
  )
    ? "ambiguous"
    : (recomputed.length > 0 && recomputed.every(({ status }) => status === "supports-recorded")) ||
        recordedTransitionProof
      ? "deterministic"
      : "unproven";
  const inputOutcome: ChangeProofCaseResult["inputOutcome"] =
    run.outcome === "uncertain" || /OUTCOME_UNKNOWN/u.test(run.errorCode ?? "")
      ? "unreconciled"
      : "reconciled";
  const evidenceComplete = pack.completeness.status === "complete";
  const cleanup = cleanupOutcome(run, cell.cleanupRequired);
  const infrastructureFailure =
    run.outcome === "harness-failure" &&
    (run.failureCategory === "environment" || run.failureCategory === "target-state");
  const outcome: ChangeProofCaseResult["outcome"] =
    analysis.historicalVerdict === "failed" || run.outcome === "product-failure"
      ? "rejected"
      : infrastructureFailure
        ? "infrastructure-failure"
        : run.review?.status === "pending"
          ? "needs-review"
          : analysis.historicalVerdict === "proved" &&
              evidenceComplete &&
              selectorResolution === "deterministic" &&
              inputOutcome === "reconciled" &&
              cleanup !== "failed" &&
              cleanup !== "unproved"
            ? "passed"
            : "insufficient-evidence";
  return changeProofCaseResultSchema.parse({
    cellId: cell.id,
    appMapId: identity.appMapId,
    testId: identity.testId,
    targetCaseId: targetCase.id,
    runId: run.id,
    sourceSha: build.sourceSha,
    buildId: build.id,
    artifactDigest: build.artifactDigest,
    outcome,
    evidenceDigests: [pack.digest],
    evidenceComplete,
    selectorResolution,
    inputOutcome,
    cleanup,
    ...(outcome === "rejected" || outcome === "infrastructure-failure"
      ? {
          failure: {
            summary:
              run.error?.trim() ||
              run.errorCode?.trim() ||
              analysis.smallestLiveVerification.reason,
            evidenceRefs: [pack.digest],
            relevantLogs: run.logs.slice(-32),
            suggestedScope: [identity.appMapId, identity.testId, targetCase.id],
          },
        }
      : {}),
  });
}

export type LiveChangeProofExecution = Readonly<{
  proofId: string;
  pilot: ChangeProofRunCase;
  expansion: readonly ChangeProofRunCase[];
  results: readonly ChangeProofCaseResult[];
  decision: ReturnType<typeof decideChangeVerification>;
  published: boolean;
}>;

/** Execute the minimal pilot, stop immediately on a definitive non-pass, and
 * expand only after a complete passing pilot. Provider publication is an
 * explicit injected integration; absence means no external side effect. */
export async function executeLiveChangeProof(input: {
  proof: unknown;
  authority: "confirmed";
  /** The execution boundary returns only Relay's immutable persisted Run.
   * Per-case verdicts are always re-derived below from its verified TracePack. */
  runCase: (item: ChangeProofRunCase) => Promise<PersistedRun>;
  /** Maximum number of materialized cells accepted by this execution. */
  maxCases?: number;
  /** Wall-clock budget checked before each target-control call. */
  maxDurationMs?: number;
  now?: () => number;
  publish?: (decision: ReturnType<typeof decideChangeVerification>) => Promise<void>;
}): Promise<LiveChangeProofExecution> {
  const proof = parseChangeVerification(input.proof);
  if (input.authority !== "confirmed") throw new Error("Live Proof execution requires authority.");
  if (proof.state !== "ready" || !proof.planApproval) {
    throw new Error("Live Proof execution requires an approved ready Verification Plan.");
  }
  const cases = changeProofRequiredRunCases(proof);
  const maxCases = input.maxCases ?? cases.length;
  if (!Number.isSafeInteger(maxCases) || maxCases < 1 || cases.length > maxCases) {
    throw new Error(
      `Proof materializes ${cases.length} Verification Cells, exceeding its ${maxCases}-case limit.`,
    );
  }
  const maxDurationMs = input.maxDurationMs ?? 1_800_000;
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) {
    throw new Error("Live Proof maxDurationMs must be a positive safe integer.");
  }
  const now = input.now ?? Date.now;
  const startedAt = now();
  const assertDurationBudget = (): void => {
    if (now() - startedAt >= maxDurationMs) {
      throw new Error("Live Proof duration budget expired before target control.");
    }
  };
  const pilot = cases[0];
  if (!pilot) throw new Error("Live Proof execution requires at least one policy-required case.");
  const runAndProject = async (item: ChangeProofRunCase): Promise<ChangeProofCaseResult> => {
    assertDurationBudget();
    const run = await input.runCase(item);
    return changeProofCaseResultFromPersistedRun({ proof, run });
  };
  const results: ChangeProofCaseResult[] = [await runAndProject(pilot)];
  if (results[0]!.outcome === "passed") {
    for (const item of cases.slice(1)) {
      const result = await runAndProject(item);
      results.push(result);
      if (result.outcome !== "passed") break;
    }
  }
  const decision = decideChangeVerification({ proof, caseResults: results });
  if (input.publish) await input.publish(decision);
  return {
    proofId: proof.id,
    pilot,
    expansion: cases.slice(1),
    results,
    decision,
    published: Boolean(input.publish),
  };
}
