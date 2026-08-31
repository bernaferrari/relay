import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import {
  changeProofCaseResultFromPersistedRun,
  changeProofRequiredRunCases,
  executeLiveChangeProof,
} from "./change-proof-live-run.js";
import type { PersistedRun } from "./runs.js";
import { canonicalSha256 } from "./canonical-json.js";
import { compileExecutionRisk } from "./execution-risk-compiler.js";

const headSha = "2".repeat(40);
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  maximumActions: 0,
  maximumDurationMs: 0,
  cleanupRequired: false,
};
const safeExecutionRiskDigest = canonicalSha256(safeExecutionRisk);
const evidencePolicy = { schemaVersion: 1 as const, sensitive: {} };
const evidencePolicyDigest = canonicalSha256(evidencePolicy);

function targetCase(id: string): ChangeVerification["selection"]["targetCases"][number] {
  return {
    id,
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: "relay.local.browser", scope: "local" },
      targetId: "web",
      platform: "browser",
      identity: { kind: "browser-target", value: "web" },
    },
    targetProfile: {
      id: `web:${id}`,
      targetId: "web",
      source: "browser",
      platform: "browser",
      name: id,
      viewport: { width: 390, height: 844 },
      browserCaseProfile: {
        schemaVersion: 1,
        engine: id.startsWith("webkit") ? "webkit" : "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        mobile: true,
        touch: true,
        locale: "ar",
        timezoneId: "UTC",
        colorScheme: "dark",
        reducedMotion: "no-preference",
        permissions: [],
        offline: false,
        environmentRevision: "fixture-v1",
      },
      capabilities: ["snapshot", "screenshot", "tap"],
      observedAt: 100,
    },
    dimensions: { locale: "ar" },
    required: true,
  };
}

function proof(): ChangeVerification {
  return {
    schemaVersion: 2,
    id: "proof-live",
    organizationId: "acme",
    projectId: "relay",
    version: 2,
    state: "ready",
    change: { repository: "acme/settings", baseSha: "1".repeat(40), headSha },
    builds: [
      {
        id: "web",
        platform: "web",
        artifactDigest: digest("a"),
        sourceSha: headSha,
        configuration: "production",
        environmentRevision: "fixture-v1",
      },
    ],
    selection: {
      affectedJourneys: [
        {
          appMapId: "settings",
          testId: "settings-language",
          appMapRevision: 1,
          reason: "Settings localization changed.",
          confidence: "definite",
        },
      ],
      targetCases: [targetCase("chromium-ar"), targetCase("webkit-ar")],
      cells: [
        {
          id: "cell-settings-chromium",
          journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 1 },
          targetCaseId: "chromium-ar",
          buildId: "web",
          requirement: "required",
          selectionReason: "Chromium Arabic is required coverage.",
          dimensions: { locale: "ar" },
          executionRisk: safeExecutionRisk,
          executionRiskDigest: safeExecutionRiskDigest,
          evidencePolicyDigest,
          cleanupRequired: false,
        },
        {
          id: "cell-settings-webkit",
          journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 1 },
          targetCaseId: "webkit-ar",
          buildId: "web",
          requirement: "required",
          selectionReason: "WebKit Arabic is required coverage.",
          dimensions: { locale: "ar" },
          executionRisk: safeExecutionRisk,
          executionRiskDigest: safeExecutionRiskDigest,
          evidencePolicyDigest,
          cleanupRequired: false,
        },
      ],
      pilotCellId: "cell-settings-chromium",
    },
    planApproval: {
      decisionId: "decision-1",
      approvedBy: "human:reviewer",
      approvedAt: 200,
      reason: "Reviewed exact plan.",
    },
    policy: { id: "relay.default", version: 3 },
    runIds: [],
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    smallestNextVerification: { kind: "run-pilot", reason: "Run the pilot." },
    requestedBy: "agent:coder",
    updatedBy: "human:reviewer",
    lastMutation: {
      schemaVersion: 1,
      requestId: "approve-request",
      requestDigest: digest("f"),
      action: "approve-plan",
      actorId: "human:reviewer",
      proofId: "proof-live",
      previousVersion: 1,
      version: 2,
      at: 200,
    },
    createdAt: 100,
    updatedAt: 200,
  };
}

function failedPersistedRun(): PersistedRun {
  const target = proof().selection.targetCases[0]!;
  return {
    schemaVersion: 5,
    id: "persisted-failure",
    action: "app-map:settings:settings-language",
    status: "error",
    outcome: "product-failure",
    error: "Primary action overlaps translated description.",
    attempts: 1,
    queuedAt: 300,
    startedAt: 310,
    finishedAt: 320,
    logs: ["first causal failure"],
    steps: [],
    frames: [],
    dir: ".",
    writtenAt: 320,
    evidence: {
      schemaVersion: 1,
      runId: "persisted-failure",
      target: { kind: "browser", platform: "browser" },
      startedAt: 310,
      finishedAt: 320,
      collectionPolicy: evidencePolicy,
      channels: {},
      events: [],
    } as never,
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: 300,
        data: {
          schemaVersion: 1,
          appMapId: "settings",
          appMapRevision: 1,
          test: {
            id: "settings-language",
            name: "Settings language",
            kind: "scenario",
            intentSchemaVersion: 1,
          },
          rootRecipeId: "settings:settings-language:root",
          recipes: {
            "settings:settings-language:root": {
              id: "settings:settings-language:root",
              title: "Settings language",
              parameters: [],
              steps: [],
            },
          },
          stepProvenance: [],
          performance: {
            executableOperations: 0,
            moduleCalls: 0,
            operationCounts: {},
            screenshotCount: 0,
            destinationProofCount: 0,
          },
          startup: { mode: "cold" },
        },
      },
    ],
    inputDigest: "e".repeat(64),
    resolvedInputs: { locale: "ar" },
    targetProfile: {
      ...target.targetProfile,
      capabilities: [...target.targetProfile.capabilities],
    },
    sourceRevision: { vcs: "git", sha: headSha, artifactDigest: digest("a") },
  };
}

function passedPersistedRun(withCleanup = false): PersistedRun {
  const run = failedPersistedRun();
  run.id = "persisted-pass";
  run.status = "ok";
  run.outcome = "passed";
  run.error = undefined;
  run.logs = [];
  run.artifacts.push(
    {
      kind: "campaign-transition-proof",
      capturedAt: 310,
      data: { checkId: "localized", status: "verified" },
    },
    {
      kind: "campaign-check-result",
      capturedAt: 320,
      data: {
        id: "localized",
        title: "Settings are displayed in Arabic",
        status: "passed",
      },
    },
  );
  run.evidence = {
    schemaVersion: 1,
    runId: run.id,
    target: { kind: "browser", platform: "browser" },
    startedAt: 310,
    finishedAt: 320,
    collectionPolicy: evidencePolicy,
    channels: {},
    events: [],
  } as never;
  if (withCleanup) {
    const planArtifact = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan");
    assert.ok(planArtifact);
    const plan = planArtifact.data as {
      rootRecipeId: string;
      recipes: Record<
        string,
        { id?: string; title?: string; parameters?: unknown[]; steps: unknown[] }
      >;
    };
    plan.recipes[plan.rootRecipeId]!.steps = [
      {
        kind: "module",
        recipeId: "cleanup-routine",
        check: {
          id: "localized",
          title: "Settings are displayed in Arabic",
          cleanup: {
            recipeId: "cleanup-routine",
            terminalScreenId: "settings",
            onCancel: "skip",
          },
        },
      },
    ];
    plan.recipes["cleanup-routine"] = {
      id: "cleanup-routine",
      title: "Cleanup",
      parameters: [],
      steps: [],
    };
  }
  return run;
}

function proofWithRequiredCleanup(): ChangeVerification {
  const base = proof();
  const cleanupRisk = { ...safeExecutionRisk, cleanupRequired: true };
  return {
    ...base,
    selection: {
      ...base.selection,
      targetCases: base.selection.targetCases.map((targetCase) => ({
        ...targetCase,
        cleanupRequired: true,
      })),
      cells: base.selection.cells!.map((cell) => ({
        ...cell,
        executionRisk: cleanupRisk,
        executionRiskDigest: canonicalSha256(cleanupRisk),
        cleanupRequired: true,
      })),
    },
  };
}

function persistedRunWithCleanupArtifact(
  cleanup: Partial<{
    checkId: string;
    recipeId: string;
    terminalScreenId: string;
    status: string;
  }> = {},
): PersistedRun {
  const run = passedPersistedRun(true);
  const planArtifact = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan");
  assert.ok(planArtifact);
  run.artifacts.push({
    kind: "campaign-check-cleanup",
    capturedAt: 321,
    data: {
      checkId: "localized",
      recipeId: "cleanup-routine",
      terminalScreenId: "settings",
      status: "passed",
      ...cleanup,
    },
  });
  return run;
}

function proofForPersistedRun(run: PersistedRun, base: ChangeVerification): ChangeVerification {
  const planArtifact = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan");
  assert.ok(planArtifact);
  const risk = compileExecutionRisk({ kind: "compiled-test", test: planArtifact.data as never });
  return {
    ...base,
    selection: {
      ...base.selection,
      cells: base.selection.cells!.map((cell) => ({
        ...cell,
        executionRisk: risk,
        executionRiskDigest: canonicalSha256(risk),
        cleanupRequired: risk.cleanupRequired,
      })),
    },
  };
}

function persistedRunFor(
  item: ReturnType<typeof changeProofRequiredRunCases>[number],
  outcome: "passed" | "rejected",
): PersistedRun {
  const run = outcome === "passed" ? passedPersistedRun() : failedPersistedRun();
  const target = proof().selection.targetCases.find(({ id }) => id === item.targetCaseId)!;
  run.id = `run-${item.targetCaseId}`;
  run.targetProfile = {
    ...target.targetProfile,
    capabilities: [...target.targetProfile.capabilities],
  };
  run.resolvedInputs = { ...target.dimensions };
  if (run.evidence) run.evidence = { ...run.evidence, runId: run.id };
  return run;
}

test("live Proof runs one deterministic pilot before required expansion", async () => {
  const executed: string[] = [];
  const value = await executeLiveChangeProof({
    proof: proof(),
    authority: "confirmed",
    runCase: async (item) => {
      executed.push(item.targetCaseId);
      return persistedRunFor(item, "passed");
    },
  });
  assert.deepEqual(executed, ["chromium-ar", "webkit-ar"]);
  assert.equal(value.pilot.targetCaseId, "chromium-ar");
  assert.deepEqual(
    value.expansion.map(({ targetCaseId }) => targetCaseId),
    ["webkit-ar"],
  );
  assert.equal(value.decision.decision, "proved");
  assert.equal(value.published, false);
});

test("live Proof stops after the first causal regression and publishes only when configured", async () => {
  const executed: string[] = [];
  let published = 0;
  const value = await executeLiveChangeProof({
    proof: proof(),
    authority: "confirmed",
    runCase: async (item) => {
      executed.push(item.targetCaseId);
      return persistedRunFor(item, "rejected");
    },
    publish: async (decision) => {
      assert.equal(decision.decision, "rejected");
      published += 1;
    },
  });
  assert.deepEqual(executed, ["chromium-ar"]);
  assert.equal(value.decision.decision, "rejected");
  assert.equal(value.decision.firstCausalFailure?.targetCaseId, "chromium-ar");
  assert.equal(published, 1);
  assert.equal(value.published, true);
});

test("live Proof uses the exact build pinned by each frozen cell", () => {
  const value = proof();
  value.builds = [
    ...value.builds,
    { ...value.builds[0]!, id: "web-second", artifactDigest: digest("d") },
  ];
  assert.equal(changeProofRequiredRunCases(value)[0]!.buildId, "web");
});

test("live Proof requires one frozen App Map revision before target execution", () => {
  const value = proof();
  value.selection.affectedJourneys = value.selection.affectedJourneys.map(
    ({ appMapRevision: _revision, ...journey }) => journey,
  );
  assert.throws(() => changeProofRequiredRunCases(value), /no frozen App Map revision/u);
});

test("persisted Run projection derives rejection and evidence without client verdict input", async () => {
  const projected = await changeProofCaseResultFromPersistedRun({
    proof: proof(),
    run: failedPersistedRun(),
  });
  assert.equal(projected.outcome, "rejected");
  assert.equal(projected.targetCaseId, "chromium-ar");
  assert.match(projected.evidenceDigests[0] ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.match(projected.failure?.summary ?? "", /overlaps translated description/u);

  const forged = failedPersistedRun();
  forged.sourceRevision = { ...forged.sourceRevision!, artifactDigest: digest("9") };
  await assert.rejects(
    changeProofCaseResultFromPersistedRun({ proof: proof(), run: forged }),
    /exactly one frozen Proof build/u,
  );

  const malformedPlan = failedPersistedRun();
  malformedPlan.artifacts[0] = {
    kind: "app-map-test-plan",
    capturedAt: 300,
    data: { appMapId: "settings", test: { id: "settings-language" } },
  };
  await assert.rejects(
    changeProofCaseResultFromPersistedRun({ proof: proof(), run: malformedPlan }),
    /no frozen App Map Test identity/u,
  );

  const wrongRevision = failedPersistedRun();
  const planArtifact = wrongRevision.artifacts[0]!;
  planArtifact.data = { ...(planArtifact.data as object), appMapRevision: 2 };
  await assert.rejects(
    changeProofCaseResultFromPersistedRun({ proof: proof(), run: wrongRevision }),
    /exact frozen App Map revision/u,
  );
});

test("persisted Run projection accepts complete recorded selector proof", async () => {
  const projected = await changeProofCaseResultFromPersistedRun({
    proof: proof(),
    run: passedPersistedRun(),
  });
  assert.equal(projected.outcome, "passed");
  assert.equal(projected.evidenceComplete, true);
  assert.equal(projected.selectorResolution, "deterministic");
  assert.equal(projected.inputOutcome, "reconciled");
  assert.equal(projected.cleanup, "not-required");
});

test("persisted Run projection requires the exact frozen evidence policy", async () => {
  const missing = passedPersistedRun();
  delete missing.evidence!.collectionPolicy;
  await assert.rejects(
    changeProofCaseResultFromPersistedRun({ proof: proof(), run: missing }),
    /no frozen evidence policy/u,
  );

  const changed = passedPersistedRun();
  changed.evidence!.collectionPolicy = {
    schemaVersion: 1,
    sensitive: {
      crash: { grantedAt: 1, grantedBy: "human:reviewer", reason: "Different policy" },
    },
  };
  await assert.rejects(
    changeProofCaseResultFromPersistedRun({ proof: proof(), run: changed }),
    /evidence policy does not match/u,
  );
});

test("required cleanup without a recorded restoration cannot prove a case", async () => {
  const run = passedPersistedRun(true);
  const value = proofForPersistedRun(run, proofWithRequiredCleanup());
  const projected = await changeProofCaseResultFromPersistedRun({
    proof: value,
    run,
  });
  assert.equal(projected.cleanup, "unproved");
  assert.equal(projected.outcome, "insufficient-evidence");
});

test("persisted Proof accepts exactly one cleanup artifact for the frozen check", async () => {
  const run = persistedRunWithCleanupArtifact();
  const projected = await changeProofCaseResultFromPersistedRun({
    proof: proofForPersistedRun(run, proofWithRequiredCleanup()),
    run,
  });
  assert.equal(projected.cleanup, "restored");
  assert.equal(projected.outcome, "passed");
});

test("persisted Proof does not use an unrelated cleanup artifact", async () => {
  const run = persistedRunWithCleanupArtifact({ checkId: "unrelated-check" });
  const projected = await changeProofCaseResultFromPersistedRun({
    proof: proofForPersistedRun(run, proofWithRequiredCleanup()),
    run,
  });
  assert.equal(projected.cleanup, "unproved");
  assert.equal(projected.outcome, "insufficient-evidence");
});

test("persisted Proof does not use duplicate cleanup artifacts", async () => {
  const run = persistedRunWithCleanupArtifact();
  const cleanup = run.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
  assert.ok(cleanup);
  run.artifacts.push(structuredClone(cleanup));
  const projected = await changeProofCaseResultFromPersistedRun({
    proof: proofForPersistedRun(run, proofWithRequiredCleanup()),
    run,
  });
  assert.equal(projected.cleanup, "unproved");
  assert.equal(projected.outcome, "insufficient-evidence");
});

test("live Proof rejects a materialized-cell count over budget before target control", async () => {
  let executed = 0;
  await assert.rejects(
    executeLiveChangeProof({
      proof: proof(),
      authority: "confirmed",
      maxCases: 1,
      runCase: async () => {
        executed += 1;
        return passedPersistedRun();
      },
    }),
    /materializes 2 Verification Cells/u,
  );
  assert.equal(executed, 0);
});

test("live Proof rejects an expired duration budget before target control", async () => {
  let clockReads = 0;
  let executed = 0;
  await assert.rejects(
    executeLiveChangeProof({
      proof: proof(),
      authority: "confirmed",
      maxDurationMs: 1,
      now: () => (clockReads++ === 0 ? 100 : 101),
      runCase: async () => {
        executed += 1;
        return passedPersistedRun();
      },
    }),
    /duration budget expired before target control/u,
  );
  assert.equal(executed, 0);
});

test("persisted Run projection keeps target infrastructure failure distinct", async () => {
  const run = passedPersistedRun();
  run.outcome = "harness-failure";
  run.failureCategory = "environment";
  run.error = "Browser worker exited before the target page was available.";
  const projected = await changeProofCaseResultFromPersistedRun({ proof: proof(), run });
  assert.equal(projected.outcome, "infrastructure-failure");
  assert.match(projected.failure?.summary ?? "", /Browser worker exited/u);
});
