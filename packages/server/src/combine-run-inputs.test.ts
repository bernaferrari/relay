import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  combineCampaignCaseFromPreparedCell,
  createCombineCampaign,
  listJobs,
  parseAppMapCombineCellExecutionIntent,
  prepareAppMapCombineCells,
  registerGenerationProvider,
  deterministicGenerationProvider,
  runWithOperationContext,
  stagePreparedAppMapCombineCells,
  writeProjectVariables,
} from "@relay/core";
import { startServer } from "./index.js";
import {
  freezeCombineRunInputs,
  restoreCombineRunInputs,
  requireCombineRunInputs,
} from "./combine-run-inputs.js";
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

test("selected rows freeze distinct approved child inputs and resume their exact receipts", async () => {
  const projectId = "native-combine-selected-inputs";
  const { map, targetId } = await nativePromptCombineFixture(projectId);
  map.variables.language!.name = "chat_prompt";
  const data = {
    id: "prompt-data",
    name: "chat_prompt",
    scope: "shared" as const,
    source: "list" as const,
    values: ["en", "it"],
  };
  const prepare = () =>
    prepareAppMapCombineCells({
      map,
      combine: map.combines.daily!,
      target: { targetId, platform: "android" },
      seed: 1000,
    });
  const prepared = await prepare();
  const graphs = prepared.cells.map((cell) => JSON.stringify(cell.childIntent.recipeGraph));
  const digests = prepared.cells.map((cell) => cell.outerIntent.digest);
  await freezeCombineRunInputs({
    projectId,
    cells: prepared.cells,
    seed: 1000,
    readProjectVariables: async () => ({ revision: 3, updatedAt: 1, value: [data] }),
  });
  assert.deepEqual(
    prepared.cells.map((cell) => cell.runtimeInputs?.variables.chat_prompt),
    ["en", "it"],
  );
  assert.notEqual(
    prepared.cells[0]!.runtimeInputs?.receipt.valuesDigest,
    prepared.cells[1]!.runtimeInputs?.receipt.valuesDigest,
  );
  for (const [index, cell] of prepared.cells.entries()) {
    assert.equal(JSON.stringify(cell.childIntent.recipeGraph), graphs[index]);
    assert.notEqual(cell.outerIntent.digest, digests[index]);
    const sealed = parseAppMapCombineCellExecutionIntent(cell.outerIntent);
    assert.deepEqual(sealed?.cell.values, cell.values);
    assert.deepEqual(sealed?.child.frozenInputs, cell.runtimeInputs?.receipt);
    assert.ok(Object.values(cell.wrapperInputs).includes(cell.values.language!));
  }
  const cases = prepared.cells.map((cell, index) =>
    combineCampaignCaseFromPreparedCell(cell, { index, phase: "coverage", status: "pending" }),
  );
  const restored = await prepare();
  restored.cells.forEach((cell) => {
    cell.selectedDataRows![0]!.name = "Renamed after admission";
  });
  restoreCombineRunInputs(restored.cells, cases);
  requireCombineRunInputs(restored.cells);
  assert.deepEqual(
    restored.cells.map((cell) => cell.runtimeInputs?.variables.chat_prompt),
    ["en", "it"],
  );
  assert.deepEqual(
    restored.cells.map((cell) => cell.outerIntent.digest),
    prepared.cells.map((cell) => cell.outerIntent.digest),
  );

  const override = await prepare();
  await assert.rejects(
    freezeCombineRunInputs({
      projectId,
      cells: override.cells,
      seed: 1000,
      variables: { "prompt-data": "en" },
      readProjectVariables: async () => ({ revision: 3, updatedAt: 1, value: [data] }),
    }),
    /Selected row and supplied value disagree/,
  );
  assert.ok(override.cells.every((cell) => !cell.runtimeInputs));
});

test("the entire row and wrapper scope validates before any generation or binding", async () => {
  const projectId = "native-combine-row-input-preflight";
  const { map, targetId } = await nativePromptCombineFixture(projectId);
  map.variables.language!.name = "chat_prompt";
  map.tests.prompt!.steps[0]!.binding = {
    status: "resolved",
    kind: "script",
    source: 'return "{{chat_prompt}} {{extra_input}}";',
  };
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.daily!,
    target: { targetId, platform: "android" },
    seed: 1000,
  });
  let generations = 0;
  const unregister = registerGenerationProvider({
    id: "deterministic",
    generate: async () => {
      generations++;
      throw new Error("Generation must not start");
    },
  });
  const digests = prepared.cells.map((cell) => cell.outerIntent.digest);
  try {
    await assert.rejects(
      freezeCombineRunInputs({
        projectId,
        cells: prepared.cells,
        seed: 1000,
        readProjectVariables: async () => ({
          revision: 3,
          updatedAt: 1,
          value: [
            {
              id: "prompt-data",
              name: "chat_prompt",
              scope: "shared",
              source: "list",
              values: ["en"],
            },
            {
              id: "extra",
              name: "extra_input",
              scope: "shared",
              source: "generated",
              prompt: "Generate a question",
            },
          ],
        }),
      }),
      /not an approved Test input value/,
    );
    assert.equal(generations, 0);
    assert.ok(prepared.cells.every((cell) => !cell.runtimeInputs));
    assert.deepEqual(
      prepared.cells.map((cell) => cell.outerIntent.digest),
      digests,
    );
    const first = prepared.cells[0]!;
    first.childIntent.recipeGraph[first.childIntent.sourcePlan.rootRecipeId]!.steps.push({
      kind: "type",
      text: `{{${Object.keys(first.wrapperInputs)[0]}}}`,
    });
    await assert.rejects(
      freezeCombineRunInputs({
        projectId,
        cells: prepared.cells,
        seed: 1000,
        readProjectVariables: async () => ({
          revision: 3,
          updatedAt: 1,
          value: [
            {
              id: "prompt-data",
              name: "chat_prompt",
              scope: "shared",
              source: "list",
              values: ["en", "it"],
            },
          ],
        }),
      }),
      /conflicts with its Combine wrapper inputs/,
    );
    assert.equal(generations, 0);
  } finally {
    unregister();
    registerGenerationProvider(deterministicGenerationProvider);
  }
});
