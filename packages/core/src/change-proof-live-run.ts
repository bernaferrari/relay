import {
  changeProofCaseResultSchema,
  parseChangeVerification,
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

export type ChangeProofRunCase = Readonly<{
  appMapId: string;
  testId: string;
  appMapRevision: number;
  targetCaseId: string;
  buildId: string;
}>;

function platformForTargetCase(
  item: ChangeVerification["selection"]["targetCases"][number],
): ChangeVerification["builds"][number]["platform"] {
  return item.executionTarget.platform === "browser" ? "web" : item.executionTarget.platform;
}

function buildForTargetCase(
  proof: ChangeVerification,
  targetCase: ChangeVerification["selection"]["targetCases"][number],
): ChangeVerification["builds"][number] {
  const matching = proof.builds.filter(
    (build) => build.platform === platformForTargetCase(targetCase),
  );
  if (matching.length !== 1) {
    throw new Error(
      `Target case ${targetCase.id} requires exactly one frozen ${platformForTargetCase(targetCase)} build; found ${matching.length}.`,
    );
  }
  return matching[0]!;
}

/** Deterministic required Cartesian coverage. The first entry is the pilot;
 * the remainder is the smallest policy-required expansion. */
export function changeProofRequiredRunCases(value: unknown): ChangeProofRunCase[] {
  const proof = parseChangeVerification(value);
  const targets = proof.selection.targetCases.filter(({ required }) => required);
  return proof.selection.affectedJourneys.flatMap((journey) => {
    if (journey.appMapRevision === undefined) {
      throw new Error(
        `Affected journey ${journey.appMapId}/${journey.testId} has no frozen App Map revision.`,
      );
    }
    return targets.map((targetCase) => ({
      appMapId: journey.appMapId,
      testId: journey.testId,
      appMapRevision: journey.appMapRevision!,
      targetCaseId: targetCase.id,
      buildId: buildForTargetCase(proof, targetCase).id,
    }));
  });
}

function planIdentity(
  run: PersistedRun,
): { appMapId: string; testId: string; appMapRevision: number } | undefined {
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "app-map-test-plan") continue;
    const plan = parseCanonicalAppMapTestPlan(artifact.data);
    if (plan) {
      return {
        appMapId: plan.appMapId,
        testId: plan.test.id,
        appMapRevision: plan.appMapRevision,
      };
    }
  }
  return undefined;
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
      build.sourceSha === revision?.sha && build.artifactDigest === revision.artifactDigest,
  );
  if (matching.length !== 1) {
    throw new Error(
      `Run ${run.id} must bind exactly one frozen Proof build; found ${matching.length}.`,
    );
  }
  return matching[0]!;
}

function cleanupOutcome(run: PersistedRun): ChangeProofCaseResult["cleanup"] {
  const cleanup = run.artifacts.filter((artifact) => artifact.kind === "campaign-check-cleanup");
  if (!cleanup.length) return "restored";
  return cleanup.every((artifact) => {
    const data = artifact.data;
    return (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      (data as { status?: unknown }).status === "passed"
    );
  })
    ? "restored"
    : "unproved";
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
  const identity = planIdentity(run);
  if (!identity) throw new Error(`Run ${run.id} has no frozen App Map Test identity.`);
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
              cleanupOutcome(run) === "restored"
            ? "passed"
            : "insufficient-evidence";
  return changeProofCaseResultSchema.parse({
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
    cleanup: cleanupOutcome(run),
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
  publish?: (decision: ReturnType<typeof decideChangeVerification>) => Promise<void>;
}): Promise<LiveChangeProofExecution> {
  const proof = parseChangeVerification(input.proof);
  if (input.authority !== "confirmed") throw new Error("Live Proof execution requires authority.");
  if (proof.state !== "ready" || !proof.planApproval) {
    throw new Error("Live Proof execution requires an approved ready Verification Plan.");
  }
  const cases = changeProofRequiredRunCases(proof);
  const pilot = cases[0];
  if (!pilot) throw new Error("Live Proof execution requires at least one policy-required case.");
  const runAndProject = async (item: ChangeProofRunCase): Promise<ChangeProofCaseResult> =>
    changeProofCaseResultFromPersistedRun({ proof, run: await input.runCase(item) });
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
