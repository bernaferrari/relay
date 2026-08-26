import assert from "node:assert/strict";
import test from "node:test";
import { RelayClient } from "@relay/client";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type OperationId,
  type OperationInput,
  type OperationOutput,
} from "@relay/protocol";
import { createServerCombineController } from "./server-combine-controller.js";

function clientFor(handler: (id: OperationId, input: unknown) => unknown): RelayClient {
  const client = new RelayClient({
    url: "http://relay.test",
    auth: { type: "none" },
    organizationId: "local",
    projectId: "default",
    actorId: "human:test",
    actorKind: "human",
  });
  client.invoke = async <Id extends OperationId>(
    id: Id,
    input: OperationInput<Id>,
  ): Promise<OperationOutput<Id>> => handler(id, input) as OperationOutput<Id>;
  return client;
}

test("single-Test execution selects the exact queued compiler root", async () => {
  let selectedJob = "";
  let selectedAction = "";
  const rootRecipeId = "app-map:shop:test:checkout:root:r7";
  const client = clientFor((id) => {
    assert.equal(id, "job.combine.start");
    return {
      batch: {
        id: "job-1",
        title: "Checkout",
        worlds: ["once"],
        recipeId: rootRecipeId,
      },
      jobs: [
        {
          id: "job-1",
          action: rootRecipeId,
          status: "queued",
          queuedAt: 1,
          logs: [],
        },
      ],
      matrix: { id: "job-1" },
    };
  });
  const controller = createServerCombineController({
    client: async () => client,
    health: () => "online",
    devices: () => [{ serial: "device-1", platform: "ios" }],
    selectedDevice: () => "device-1",
    selectedLeaseId: () => "lease-1",
    selectedJobId: () => null,
    projectId: () => "project",
    projectVariables: () => [],
    captureBeforeRun: async () => undefined,
    appendLog: () => undefined,
    setSelectedJobId: (id) => (selectedJob = id),
    setSelectedAction: (id) => (selectedAction = id),
    setError: () => undefined,
    refreshJobs: async () => undefined,
  });

  const result = await controller.runPathAcrossVariables({
    appMapId: "shop",
    testId: "checkout",
    title: "Checkout",
  });

  assert.deepEqual(result, { jobId: "job-1" });
  assert.equal(selectedJob, "job-1");
  assert.equal(selectedAction, rootRecipeId);
});

test("explicit local Combine bindings run without a globally selected device", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = clientFor((id, input) => {
    assert.equal(id, "job.combine.start");
    requestBody = input as Record<string, unknown>;
    return {
      batch: {
        id: "campaign-1",
        title: "Settings",
        worlds: ["Italian"],
        recipeId: "app-map:settings:test:settings:root",
      },
      jobs: [],
      matrix: { id: "campaign-1" },
      campaign: { id: "campaign-1" },
    };
  });
  const controller = createServerCombineController({
    client: async () => client,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    selectedLeaseId: () => null,
    selectedJobId: () => null,
    projectId: () => "project",
    projectVariables: () => [],
    captureBeforeRun: async () => undefined,
    appendLog: () => undefined,
    setSelectedJobId: () => undefined,
    setSelectedAction: () => undefined,
    setError: () => undefined,
    refreshJobs: async () => undefined,
  });
  const localAdmission = {
    deadlineMs: 120_000,
    durationEvidence: [
      {
        schemaVersion: 1 as const,
        cohort: {
          targetId: "ipad-1",
          platform: "ios" as const,
          testId: "settings",
          action: "app-map:settings:test:settings",
        },
        duration: {
          workItemDurationMs: 10_000,
          provenance: "observed-p50" as const,
          observedAt: 100,
          sampleCount: 5,
          maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        },
        measurement: {
          estimator: "campaign-duration-estimate" as const,
          recordSource: "persisted-runs" as const,
          durationSource: "run-wall-clock" as const,
          sampleIds: ["1", "2", "3", "4", "5"],
          observationWindow: { startedAt: 1, finishedAt: 100 },
        },
      },
    ],
  };

  const result = await controller.runPathAcrossVariables({
    appMapId: "settings",
    combineId: "language",
    cellRuntimeProfiles: [
      { testId: "settings", values: { language: "it" }, targetProfileId: "ios-profile" },
    ],
    cellTargetBindings: [
      {
        testId: "settings",
        values: { language: "it" },
        target: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "ipad-1",
          platform: "ios",
          identity: { kind: "device-serial", value: "ipad-1" },
        },
      },
    ],
    localAdmission,
  });

  assert.deepEqual(result, { jobId: null, campaignId: "campaign-1" });
  assert.equal(requestBody?.serial, undefined);
  assert.deepEqual(requestBody?.localAdmission, localAdmission);
  assert.equal((requestBody?.cellTargetBindings as unknown[])?.length, 1);
});
