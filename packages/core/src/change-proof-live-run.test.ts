import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import {
  changeProofCaseResultFromPersistedRun,
  changeProofRequiredRunCases,
  executeLiveChangeProof,
} from "./change-proof-live-run.js";
import type { PersistedRun } from "./runs.js";

const headSha = "2".repeat(40);
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

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

function passedPersistedRun(): PersistedRun {
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
    channels: {},
    events: [],
  } as never;
  return run;
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

test("live Proof refuses ambiguous build binding before target execution", () => {
  const value = proof();
  value.builds = [
    ...value.builds,
    { ...value.builds[0]!, id: "web-second", artifactDigest: digest("d") },
  ];
  assert.throws(() => changeProofRequiredRunCases(value), /exactly one frozen web build/u);
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
  assert.equal(projected.cleanup, "restored");
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
