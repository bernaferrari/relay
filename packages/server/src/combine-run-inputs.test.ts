import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  combineCampaignCaseFromPreparedCell,
  createCombineCampaign,
  listJobs,
  prepareAppMapCombineCells,
  runWithOperationContext,
  stagePreparedAppMapCombineCells,
  writeProjectVariables,
} from "@relay/core";
import { startServer } from "./index.js";
import { freezeCombineRunInputs } from "./combine-run-inputs.js";
import { nativePromptCombineFixture } from "./native-combine-inputs-test-fixture.js";

test("native Combine rejects missing prompts before discovery and stages exact frozen defaults with wrapper inputs", async () => {
  const projectId = "native-combine-input-admission";
  const { map, appMapId, targetId } = await nativePromptCombineFixture(projectId);
  const calls: string[] = [];
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      listDevices: async () => {
        calls.push("discovery");
        return [];
      },
      assertTargetControl: async () => {
        calls.push("lease");
        throw new Error("fixture lease stop");
      },
    },
  });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: "agent:input-fixture",
    actorKind: "agent",
  });
  try {
    const input = {
      appMapId,
      combineId: "daily",
      serial: targetId,
      platform: "android" as const,
      seed: 1000,
    };
    await assert.rejects(
      client.invoke("job.combine.start", input),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code: string }).code === "missing-variable",
    );
    assert.equal(calls.length, 0);
    await assert.rejects(
      client.invoke("job.combine.start", {
        ...input,
        variables: { chat_prompt: "Runtime prompt" },
      }),
      /fixture lease stop/,
    );
    assert.ok(calls.includes("lease"), "supplied prompt reaches real native admission");
    const prepared = await prepareAppMapCombineCells({
      map,
      combine: map.combines.daily!,
      target: { targetId, platform: "android" },
      seed: 1000,
    });
    await freezeCombineRunInputs({
      projectId,
      cells: prepared.selectedCells,
      seed: 1000,
      variables: { chat_prompt: "Runtime prompt" },
    });
    const before = listJobs().length;
    const stage = runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "agent:input-fixture",
        actorKind: "agent",
        organizationId: "local",
        projectId,
        operationId: "job.combine.start",
        requestId: "fixture-stage",
        idempotencyKey: "fixture-stage",
        issuedAt: 1,
      },
      () =>
        stagePreparedAppMapCombineCells({
          cells: prepared.cells,
          projectId,
          targetForCell: (cell) => cell.executionTarget,
          queuedTargetProfile: () => map.screenVariants["home-native"]!.targetProfile,
        }),
    );
    try {
      assert.equal(stage.jobs.length, 2);
      for (const [index, job] of stage.jobs.entries()) {
        assert.deepEqual(job.resolvedInputs, {
          ...prepared.cells[index]!.wrapperInputs,
          chat_prompt: "Runtime prompt",
        });
        assert.ok(JSON.stringify(job.recipeGraph).includes("{{chat_prompt}}"));
        assert.ok(
          job.artifacts.some(
            (artifact) => artifact.kind === "app-map-combine-cell-execution-intent",
          ),
        );
      }
    } finally {
      stage.rollback();
    }
    assert.equal(listJobs().length, before, "staging rollback dispatches no fixture actions");
  } finally {
    await server.close();
  }
});

test("real campaign resume retains admitted prompt despite changed project Data set and stops before target actions", async () => {
  const projectId = "native-combine-input-resume";
  const { map, appMapId, targetId } = await nativePromptCombineFixture(projectId);
  const data = {
    id: "prompt-data",
    name: "chat_prompt",
    scope: "shared" as const,
    source: "static" as const,
    values: ["Admitted prompt"],
  };
  await writeProjectVariables(projectId, { expectedRevision: 0, value: [data] });
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.daily!,
    target: { targetId, platform: "android" },
    seed: 1000,
  });
  await freezeCombineRunInputs({ projectId, cells: prepared.selectedCells, seed: 1000 });
  await createCombineCampaign({
    schemaVersion: 1,
    id: "frozen-prompt-campaign",
    projectId,
    ownerId: "agent:input-fixture",
    appMapId,
    combineId: "daily",
    sourceRevision: map.revision,
    latestRevision: map.revision,
    target: { kind: "device", id: targetId, platform: "android" },
    status: "ready-to-resume",
    createdAt: 1,
    updatedAt: 1,
    cases: prepared.cells.map((cell, index) => ({
      ...combineCampaignCaseFromPreparedCell(cell, {
        index,
        phase: index === 0 ? "pilot" : "coverage",
        status: "pending",
      }),
      ...(index === 0 ? { status: "passed" as const } : {}),
    })),
    lineage: [
      { kind: "created", at: 1, appMapRevision: map.revision, actorId: "agent:input-fixture" },
    ],
    execution: {
      selected: { language: ["en", "it"] },
      selectedCellIds: prepared.selectedCellIds,
      strategy: "zip",
      seed: 1000,
    },
  });
  await writeProjectVariables(projectId, {
    expectedRevision: 1,
    value: [{ ...data, values: ["Different prompt after pilot"] }],
  });
  let leases = 0;
  const before = listJobs().length;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      listDevices: async () => [],
      assertTargetControl: async () => {
        leases++;
        throw new Error("fixture resume lease stop");
      },
    },
  });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: "agent:input-fixture",
    actorKind: "agent",
  });
  try {
    await assert.rejects(
      client.invoke("job.combine.campaign.resume", { batchId: "frozen-prompt-campaign" }),
      /fixture resume lease stop/,
    );
    assert.equal(
      leases,
      1,
      "frozen input/graph digests remained valid at the real resume boundary",
    );
    assert.equal(listJobs().length, before);
  } finally {
    await server.close();
  }
});
