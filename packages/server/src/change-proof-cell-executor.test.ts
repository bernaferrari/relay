import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type http from "node:http";
import type { ChangeProofExecutionRecord, PersistedRun, TestJob } from "@relay/core";
import {
  canonicalSha256,
  changeProofCaseResultFromPersistedRun,
  addAppMapScreen,
  createAppMap,
  enqueueJob as enqueueCoreJob,
  getEvidenceCollectionPolicy,
  issueWebBuildProviderReceipt,
  mutateStoredAppMap,
  persistRun,
  resetControlDatabaseCache,
  runWithOperationContext,
  saveAppMapTest,
  saveBuild,
  saveBrowserTarget,
} from "@relay/core";
import {
  changeProofCellRunInput,
  recoveredChangeProofExecutionAuthority,
} from "./change-proof-cell-executor.js";
import { handleAppMapRunRoute } from "./app-map-run-routes.js";
import type { RequestContext } from "./security.js";
import {
  compileBrowserEnvironment,
  type AppMapTest,
  type ChangeVerification,
  type TargetCapability,
} from "@relay/protocol";

const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  cleanupRequired: false,
};
const prohibitedExecutionRisk = {
  ...safeExecutionRisk,
  level: "prohibited" as const,
  confirmation: "human-only" as const,
  reasons: [{ code: "reviewed-effect.purchase", explanation: "Purchase effect." }],
  externalEffects: ["purchase" as const],
};

const execution = (
  platform: "browser" | "ios",
  cellDimensions: Record<string, string> = { locale: "ar" },
) =>
  ({
    frozenProof: {
      change: { headSha: "2".repeat(40) },
      builds: [
        {
          id: "build-1",
          platform: platform === "browser" ? "web" : platform,
          sourceSha: "2".repeat(40),
          artifactDigest: `sha256:${"a".repeat(64)}`,
          configuration: "production",
          environmentRevision: "fixture-v1",
        },
      ],
      selection: {
        targetCases: [
          {
            id: "target-1",
            executionTarget: {
              schemaVersion: 1,
              kind: platform === "browser" ? "local-browser" : "physical-ios",
              provider: { key: "relay.test", scope: "local" },
              targetId: platform === "browser" ? "web" : "ios-1",
              platform,
              identity: { kind: "test-target", value: "target-1" },
            },
            targetProfile: { id: "profile-1" },
            dimensions: { locale: "ar" },
          },
        ],
        cells: [
          {
            id: "cell-1",
            journey: { appMapId: "settings", testId: "language", appMapRevision: 4 },
            targetCaseId: "target-1",
            buildId: "build-1",
            requirement: "required",
            selectionReason: "Reviewed exact execution cell.",
            dimensions: cellDimensions,
            executionRisk: safeExecutionRisk,
            executionRiskDigest: canonicalSha256(safeExecutionRisk),
            evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
            cleanupRequired: false,
          },
        ],
      },
    },
  }) as unknown as Pick<ChangeProofExecutionRecord, "frozenProof">;

test("the default cell adapter binds a browser deployment without an invalid build id", () => {
  const input = changeProofCellRunInput(execution("browser"), {
    cellId: "cell-1",
    appMapId: "settings",
    testId: "language",
    appMapRevision: 4,
    targetCaseId: "target-1",
    buildId: "build-1",
  });
  assert.deepEqual(input.target, { kind: "browser", platform: "browser", targetId: "web" });
  assert.equal(input.sourceRevision?.buildId, "build-1");
  assert.equal(input.sourceRevision?.artifactDigest, `sha256:${"a".repeat(64)}`);
});

test("the default cell adapter retains registered build identity for a device", () => {
  const input = changeProofCellRunInput(execution("ios"), {
    cellId: "cell-1",
    appMapId: "settings",
    testId: "language",
    appMapRevision: 4,
    targetCaseId: "target-1",
    buildId: "build-1",
  });
  assert.deepEqual(input.target, { kind: "device", platform: "ios", targetId: "ios-1" });
  assert.equal(input.sourceRevision?.buildId, "build-1");
});

test("the default cell adapter executes reviewed non-target dimensions as one exact Repeat", () => {
  const input = changeProofCellRunInput(execution("browser", { locale: "ar", theme: "dark" }), {
    cellId: "cell-1",
    appMapId: "settings",
    testId: "language",
    appMapRevision: 4,
    targetCaseId: "target-1",
    buildId: "build-1",
  });

  assert.deepEqual(input.in, { theme: ["dark"] });
  assert.deepEqual(input.pilotCase, { theme: "dark" });
  assert.equal(input.executionMode, "pilot");
});

test("the default cell adapter refuses a cell without frozen risk authority", () => {
  const value = execution("browser");
  const cell = value.frozenProof.selection.cells![0]!;
  value.frozenProof.selection.cells = [
    (({ executionRisk: _risk, executionRiskDigest: _digest, ...withoutAuthority }) =>
      withoutAuthority)(cell),
  ] as never;
  assert.throws(
    () =>
      changeProofCellRunInput(value, {
        cellId: "cell-1",
        appMapId: "settings",
        testId: "language",
        appMapRevision: 4,
        targetCaseId: "target-1",
        buildId: "build-1",
      }),
    /no frozen execution-risk authority/u,
  );
});

test("the default cell adapter refuses prohibited or confirmation-gated risk", () => {
  const value = execution("browser");
  const cell = value.frozenProof.selection.cells![0]!;
  value.frozenProof.selection.cells = [
    {
      ...cell,
      executionRisk: prohibitedExecutionRisk,
      executionRiskDigest: canonicalSha256(prohibitedExecutionRisk),
    },
  ] as never;
  assert.throws(
    () =>
      changeProofCellRunInput(value, {
        cellId: "cell-1",
        appMapId: "settings",
        testId: "language",
        appMapRevision: 4,
        targetCaseId: "target-1",
        buildId: "build-1",
      }),
    /prohibited and cannot be executed/u,
  );
});

test("the canonical App Map Test adapter fails closed instead of replaying a human-only step", () => {
  const value = execution("browser");
  const cell = value.frozenProof.selection.cells![0]!;
  const humanOnlyRisk = {
    ...safeExecutionRisk,
    level: "destructive" as const,
    confirmation: "human-only" as const,
    reasons: [
      {
        stepId: "delete-fixture",
        code: "reviewed-account-mutation",
        explanation: "A person must verify the fixture before deleting it.",
      },
    ],
    externalEffects: ["data-deletion" as const],
    cleanupRequired: true,
  };
  value.frozenProof.selection.cells = [
    {
      ...cell,
      executionRisk: humanOnlyRisk,
      executionRiskDigest: canonicalSha256(humanOnlyRisk),
      cleanupRequired: true,
    },
  ] as never;
  assert.throws(
    () =>
      changeProofCellRunInput(
        {
          ...value,
          humanInterventionEvidence: [
            {
              schemaVersion: 1,
              executionId: "proof-execution:exact",
              proofId: "proof-execution",
              cellId: "cell-1",
              stepId: "delete-fixture",
              evidenceDigest: `sha256:${"e".repeat(64)}`,
              recordedBy: "human:reviewer",
              recordedAt: 1,
              requestId: "human-evidence",
            },
          ],
        } as never,
        {
          cellId: "cell-1",
          appMapId: "settings",
          testId: "language",
          appMapRevision: 4,
          targetCaseId: "target-1",
          buildId: "build-1",
        },
      ),
    /canonical App Map Test executor cannot resume at that step/u,
  );
});

test("restart recovery preserves remote authority and never synthesizes local trust", () => {
  const record = {
    ...execution("browser"),
    organizationId: "org-remote",
    projectId: "project-remote",
    actorId: "agent:remote",
    requestId: "proof-run-remote",
    requestAuthority: {
      subject: "agent:remote",
      allowedProjects: ["project-remote"],
      tokenKind: "service",
      localTrusted: false,
      role: "runner",
      actorKind: "agent",
      leaseId: "lease:remote",
      leaseOwnerId: "agent:remote",
    },
  } as unknown as ChangeProofExecutionRecord;

  const recovered = recoveredChangeProofExecutionAuthority(record, 123);
  assert.equal(recovered.scope.localTrusted, false);
  assert.equal(recovered.scope.tokenKind, "service");
  assert.deepEqual(recovered.scope.allowedProjects, ["project-remote"]);
  assert.equal(recovered.operation.leaseId, "lease:remote");
  assert.equal(recovered.operation.leaseOwnerId, "agent:remote");
  assert.equal(recovered.operation.actorId, "agent:remote");
});

test("restart recovery rejects legacy executions without durable request authority", () => {
  assert.throws(
    () =>
      recoveredChangeProofExecutionAuthority(
        {
          ...execution("browser"),
          organizationId: "org",
          projectId: "project",
          actorId: "agent:legacy",
          requestId: "legacy-run",
        } as unknown as ChangeProofExecutionRecord,
        123,
      ),
    /explicit proof\.run re-admission is required/u,
  );
});

test("browser Proof route receipt projects and rejects mismatched deployment provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-proof-route-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetControlDatabaseCache();

  const sourceSha = "2".repeat(40);
  const artifactDigest = `sha256:${"a".repeat(64)}` as const;
  const executionRisk = {
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
  const evidencePolicyDigest = canonicalSha256(getEvidenceCollectionPolicy());
  const operation = {
    schemaVersion: 1 as const,
    organizationId: "acme",
    projectId: "relay",
    actorId: "agent:browser-proof-route",
    actorKind: "agent" as const,
    operationId: "app-map.test.run",
    requestId: "browser-proof-route",
    idempotencyKey: "browser-proof-route",
    issuedAt: 3,
  };
  const scope: RequestContext = {
    subject: operation.actorId,
    organizationId: operation.organizationId,
    projectId: operation.projectId,
    allowedProjects: [operation.projectId],
    tokenKind: "local",
    localTrusted: true,
    role: "runner",
  };
  const browserCaseProfile = compileBrowserEnvironment({
    engine: "chromium",
    viewport: { width: 390, height: 844 },
    locale: "ar",
    timezoneId: "UTC",
    colorScheme: "dark",
  });

  try {
    await createAppMap({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      appMapId: "settings",
      name: "Settings",
      at: 1,
    });
    const appMapTest: AppMapTest = {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      appMapId: "settings",
      id: "language",
      createdAt: 1,
      updatedAt: 1,
      name: "Language",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [],
    };
    await mutateStoredAppMap("relay", "settings", (current) =>
      saveAppMapTest(current, appMapTest, {
        expectedRevision: current.revision,
        eventId: "save-language",
        actorId: operation.actorId,
        actorKind: operation.actorKind,
        at: 2,
      }),
    );
    const browserProfile = {
      id: "browser:web",
      targetId: "web",
      source: "browser" as const,
      platform: "browser" as const,
      name: "Proof browser",
      viewport: browserCaseProfile.viewport,
      browserCaseProfile,
      capabilities: ["snapshot", "screenshot", "tap"] as TargetCapability[],
      observedAt: 3,
    };
    await mutateStoredAppMap("relay", "settings", (current) =>
      addAppMapScreen(
        current,
        {
          screen: {
            organizationId: "acme",
            projectId: "relay",
            appMapId: "settings",
            id: "home",
            createdAt: 3,
            updatedAt: 3,
            title: "Home",
            identity: { schemaVersion: 1, fingerprint: "f".repeat(64) },
            variantIds: ["home-web"],
          },
          variants: [
            {
              organizationId: "acme",
              projectId: "relay",
              appMapId: "settings",
              id: "home-web",
              createdAt: 3,
              updatedAt: 3,
              screenId: "home",
              targetProfile: browserProfile,
              observation: {
                fingerprint: "f".repeat(64),
                nodes: [],
                volatileSignals: [],
              },
              evidenceIds: ["proof-evidence"],
            },
          ],
        },
        {
          expectedRevision: current.revision,
          eventId: "save-home",
          actorId: operation.actorId,
          actorKind: operation.actorKind,
          at: 3,
        },
      ),
    );
    await saveBrowserTarget({
      id: "web",
      name: "Proof browser",
      startUrl: "https://example.test",
      headless: true,
      environment: browserCaseProfile,
    });
    const webProviderReceipt = await issueWebBuildProviderReceipt({
      provider: "fixture-host",
      deploymentId: "web-build",
      sourceUrl: "https://preview.example.test",
      sourceSha,
      deploymentDigest: artifactDigest,
      configuration: "production",
      environmentRevision: "fixture-v1",
    });
    await saveBuild({
      id: "web-build",
      projectId: scope.projectId,
      name: "Web preview",
      platform: "web",
      sourceUrl: "https://preview.example.test",
      sourceSha,
      deploymentDigest: artifactDigest,
      configuration: "production",
      environmentRevision: "fixture-v1",
      webDeploymentMode: "provider-verified",
      webProviderReceipt,
      status: "ready",
    });

    const body = {
      expectedRevision: 2,
      target: { kind: "browser" as const, platform: "browser" as const, targetId: "web" },
      sourceRevision: {
        vcs: "git" as const,
        sha: sourceSha,
        artifactDigest,
        buildId: "web-build",
      },
    };
    const request = Readable.from([
      Buffer.from(JSON.stringify(body)),
    ]) as unknown as http.IncomingMessage;
    request.headers = {};
    let status = 0;
    let responseBody = "";
    const response = {
      writeHead(nextStatus: number) {
        status = nextStatus;
        return this;
      },
      end(chunk?: string | Buffer) {
        responseBody = chunk?.toString() ?? "";
        return this;
      },
    } as unknown as http.ServerResponse;
    let queued: TestJob | undefined;
    await runWithOperationContext(operation, async () => {
      await handleAppMapRunRoute({
        method: "POST",
        pathname: "/app-maps/settings/tests/language/run",
        request,
        response,
        scope,
        proofExecutionAuthority: {
          executionRiskDigest: canonicalSha256(executionRisk),
          evidencePolicyDigest,
          buildId: "web-build",
          sourceSha,
          artifactDigest,
        },
        runtime: {
          listDevices: async () => [],
          assertTargetControl: async () => undefined as never,
          enqueueJob(input) {
            queued = enqueueCoreJob(input);
            return queued;
          },
        },
      });
    });
    assert.equal(status, 202);
    assert.ok(responseBody);
    const job = queued!;
    assert.equal(job.sourceRevision?.buildId, "web-build");
    const receipt = job.artifacts.find(
      (artifact) => artifact.kind === "proof-web-deployment-binding",
    );
    assert.ok(receipt);
    assert.deepEqual(receipt.data, {
      id: "web-build",
      sourceSha,
      platform: "web",
      artifactDigest,
      configuration: "production",
      environmentRevision: "fixture-v1",
      schemaVersion: 1,
      buildId: "web-build",
      target: { kind: "browser", id: "web", platform: "browser" },
      observation: {
        status: "verified",
        observedAt: receipt.capturedAt,
        artifactDigest,
      },
    });

    job.status = "ok";
    job.startedAt = 4;
    job.finishedAt = 5;
    job.outcome = "passed";
    job.evidence = {
      schemaVersion: 1,
      runId: job.id,
      target: { kind: "browser", platform: "browser", id: "web" },
      startedAt: 4,
      finishedAt: 5,
      collectionPolicy: structuredClone(job.evidencePolicy!),
      channels: {},
      events: [],
    } as never;
    const run = await persistRun(job);
    const targetCase = {
      id: "browser-case",
      executionTarget: job.executionTarget,
      targetProfile: job.targetProfile,
      dimensions: {},
      required: true,
    };
    const proof = {
      schemaVersion: 2,
      id: "browser-proof",
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      version: 2,
      state: "ready",
      change: { repository: "acme/settings", baseSha: "1".repeat(40), headSha: sourceSha },
      builds: [
        {
          id: "web-build",
          platform: "web",
          artifactDigest,
          sourceSha,
          configuration: "production",
          environmentRevision: "fixture-v1",
        },
      ],
      selection: {
        affectedJourneys: [
          {
            appMapId: "settings",
            testId: "language",
            appMapRevision: 2,
            reason: "changed",
            confidence: "definite",
          },
        ],
        targetCases: [targetCase],
        cells: [
          {
            id: "browser-cell",
            journey: { appMapId: "settings", testId: "language", appMapRevision: 2 },
            targetCaseId: "browser-case",
            buildId: "web-build",
            requirement: "required",
            selectionReason: "browser coverage",
            dimensions: {},
            executionRisk,
            executionRiskDigest: canonicalSha256(executionRisk),
            evidencePolicyDigest,
            cleanupRequired: false,
          },
        ],
        pilotCellId: "browser-cell",
      },
      planApproval: {
        decisionId: "decision",
        approvedBy: "human:reviewer",
        approvedAt: 3,
        reason: "Reviewed exact plan.",
      },
      policy: { id: "relay.default", version: 3 },
      runIds: [],
      evidenceDigests: [],
      coverageGaps: [],
      residualRisk: [],
      smallestNextVerification: { kind: "run-pilot", reason: "Run the pilot." },
      requestedBy: operation.actorId,
      updatedBy: "human:reviewer",
      lastMutation: {
        schemaVersion: 1,
        requestId: "approve",
        requestDigest: `sha256:${"f".repeat(64)}`,
        action: "approve-plan",
        actorId: "human:reviewer",
        proofId: "browser-proof",
        previousVersion: 1,
        version: 2,
        at: 3,
      },
      createdAt: 1,
      updatedAt: 3,
    } as unknown as ChangeVerification;
    const projected = await changeProofCaseResultFromPersistedRun({ proof, run });
    assert.equal(projected.buildId, "web-build");

    const mismatched = structuredClone(run) as PersistedRun;
    const mismatchedReceipt = mismatched.artifacts.find(
      (artifact) => artifact.kind === "proof-web-deployment-binding",
    );
    assert.ok(mismatchedReceipt);
    (mismatchedReceipt.data as { artifactDigest: string }).artifactDigest =
      `sha256:${"b".repeat(64)}`;
    await assert.rejects(
      changeProofCaseResultFromPersistedRun({ proof, run: mismatched }),
      /web deployment binding that does not match/u,
    );
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
