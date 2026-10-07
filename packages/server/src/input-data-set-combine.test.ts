import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  combineCampaignCaseFromPreparedCell,
  parseAppMapCombineCellExecutionIntent,
  prepareAppMapCombineCells,
  formatAppMapYaml,
  readAppMap,
  mutateStoredAppMap,
  writeProjectVariables,
} from "@relay/core";
import {
  freezeCombineRunInputs,
  requireCombineRunInputs,
  restoreCombineRunInputs,
} from "./combine-run-inputs.js";
import { nativeInputDataSetCombineFixture } from "./native-combine-inputs-test-fixture.js";
import { startServer } from "./index.js";
import { defaultJobRouteRuntime } from "./job-routes.js";

test("input-only native Plan freezes distinct rows without changing the child or adding target actions", async () => {
  const projectId = "native-input-only-rows";
  const { map, targetId, values } = await nativeInputDataSetCombineFixture(projectId);
  const prepare = () =>
    prepareAppMapCombineCells({
      map,
      combine: map.combines.daily!,
      target: { targetId, platform: "android" },
      seed: 1000,
    });
  const prepared = await prepare();
  assert.equal(prepared.cells.length, 2);
  assert.deepEqual(
    prepared.cells[0]!.childIntent.recipeGraph,
    prepared.cells[1]!.childIntent.recipeGraph,
  );
  const graph = structuredClone(prepared.cells[0]!.childIntent.recipeGraph);
  for (const cell of prepared.cells) {
    assert.deepEqual(cell.wrapperInputs, {});
    assert.deepEqual(cell.recipeSnapshot.steps, [
      { kind: "module", recipeId: cell.childIntent.plan.rootRecipeId },
    ]);
    assert.ok(!Object.keys(cell.recipeGraph).some((id) => id.startsWith("__opt_")));
    assert.equal(cell.selectedDataRows![0]!.inputId, "prompt-data");
  }
  await freezeCombineRunInputs({ projectId, cells: prepared.cells, seed: 1000 });
  assert.deepEqual(
    prepared.cells.map((cell) => cell.runtimeInputs?.variables.chat_prompt),
    values,
  );
  const receipts = prepared.cells.map((cell) => cell.runtimeInputs!.receipt);
  assert.notEqual(receipts[0]!.valuesDigest, receipts[1]!.valuesDigest);
  for (const cell of prepared.cells) {
    assert.deepEqual(cell.childIntent.recipeGraph, graph);
    assert.deepEqual(
      parseAppMapCombineCellExecutionIntent(cell.outerIntent)?.child.frozenInputs,
      cell.runtimeInputs!.receipt,
    );
  }
  const cases = prepared.cells.map((cell, index) =>
    combineCampaignCaseFromPreparedCell(cell, { index, phase: "coverage", status: "pending" }),
  );
  await writeProjectVariables(projectId, {
    expectedRevision: 1,
    value: [
      {
        id: "prompt-data",
        name: "renamed_prompt",
        scope: "shared",
        source: "list",
        values: ["Edited after admission"],
      },
    ],
  });
  const restored = await prepare();
  restoreCombineRunInputs(restored.cells, cases);
  requireCombineRunInputs(restored.cells);
  assert.deepEqual(
    restored.cells.map((cell) => cell.runtimeInputs?.variables.chat_prompt),
    values,
  );
  assert.deepEqual(
    restored.cells.map((cell) => cell.outerIntent.digest),
    prepared.cells.map((cell) => cell.outerIntent.digest),
  );
  await assert.rejects(
    freezeCombineRunInputs({ projectId, cells: (await prepare()).cells, seed: 2000 }),
    /approved Project input values/,
  );
});

test("canonical input Data set save, import, and duplicate reject non-public definitions before persistence", async () => {
  const projectId = "input-only-public-creation";
  const { map, appMapId } = await nativeInputDataSetCombineFixture(projectId);
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: "human:input-fixture",
    actorKind: "human",
  });
  try {
    let dataRevision = 1;
    for (const value of [
      [],
      [
        {
          id: "prompt-data",
          name: "chat_prompt",
          scope: "private" as const,
          source: "static" as const,
        },
      ],
      [
        {
          id: "prompt-data",
          name: "chat_prompt",
          scope: "shared" as const,
          source: "generated" as const,
          values: ["Describe ocean tides"],
        },
      ],
      [
        {
          id: "prompt-data",
          name: "chat_prompt",
          scope: "shared" as const,
          source: "list" as const,
          sensitive: true,
          values: ["Describe ocean tides"],
        },
      ],
    ]) {
      await writeProjectVariables(projectId, { expectedRevision: dataRevision++, value });
      await assert.rejects(
        client.invoke("app-map.variable.save", {
          appMapId,
          variableId: "candidate",
          expectedRevision: map.revision,
          variable: map.variables.questions!,
        }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 400 &&
          (error.body as { code: string }).code === "invalid-map",
      );
      assert.deepEqual(await readAppMap(projectId, appMapId), map);
      await assert.rejects(
        client.invoke("app-map.import", { yaml: formatAppMapYaml(map), conflict: "copy" }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 409 &&
          (error.body as { code: string }).code === "invalid-map",
      );
      assert.equal(await readAppMap(projectId, `${appMapId}-copy`), null);
    }
    await assert.rejects(
      client.invoke("app-map.duplicate", {
        sourceAppMapId: appMapId,
        appMapId: "duplicate",
        name: "Duplicate",
      }),
      /public, non-sensitive/,
    );
    assert.equal(await readAppMap(projectId, "duplicate"), null);
    const renamed = await mutateStoredAppMap(projectId, appMapId, (current) => ({
      ...current,
      name: "Renamed app",
      revision: current.revision + 1,
    }));
    assert.equal(
      renamed.name,
      "Renamed app",
      "unchanged old binding does not block unrelated map edits",
    );
    const longPrompt = "Describe a detailed scene. ".repeat(600);
    await writeProjectVariables(projectId, {
      expectedRevision: dataRevision,
      value: [
        {
          id: "prompt-data",
          name: "chat_prompt",
          scope: "shared",
          source: "list",
          values: [longPrompt],
        },
      ],
    });
    await client.invoke("app-map.variable.save", {
      appMapId,
      variableId: "candidate",
      expectedRevision: renamed.revision,
      variable: {
        ...map.variables.questions!,
        options: [{ id: "value-1", label: "Detailed scene", value: longPrompt }],
      },
    });
    const saved = await readAppMap(projectId, appMapId);
    assert.equal(saved?.variables.candidate?.options[0]?.value, longPrompt);
    assert.equal(saved?.variables.candidate?.options[0]?.id, "value-1");
  } finally {
    await server.close();
  }
});

test("mixed Chat and Imagine rows retain both world dimensions while consuming only each Test input", async () => {
  const projectId = "input-only-mixed-plan";
  const { appMapId, targetId, values } = await nativeInputDataSetCombineFixture(projectId);
  const imageValues = ["Draw a blue fox", "Draw an orange paper boat"];
  const definitions = [
    {
      id: "prompt-data",
      name: "chat_prompt",
      scope: "shared" as const,
      source: "list" as const,
      values,
    },
    {
      id: "image-data",
      name: "image_prompt",
      scope: "shared" as const,
      source: "list" as const,
      values: imageValues,
    },
  ];
  await writeProjectVariables(projectId, { expectedRevision: 1, value: definitions });
  const map = await mutateStoredAppMap(projectId, appMapId, (current) => ({
    ...current,
    revision: current.revision + 1,
    variables: {
      ...current.variables,
      pictures: {
        ...current.variables.questions!,
        id: "pictures",
        name: "Pictures",
        apply: { kind: "input", inputId: "image-data" },
        options: imageValues.map((value, index) => ({ id: `p${index + 1}`, value })),
      },
    },
    tests: {
      ...current.tests,
      image: {
        ...current.tests.prompt!,
        id: "image",
        name: "Image",
        steps: [
          {
            id: "image",
            kind: "script",
            intent: "Use image prompt",
            binding: { status: "resolved", kind: "script", source: 'return "{{image_prompt}}";' },
          },
        ],
      },
    },
    combines: {
      daily: {
        ...current.combines.daily!,
        variableIds: ["questions", "pictures"],
        testIds: ["prompt", "image"],
        strategy: "zip",
        selected: { questions: ["q1", "q2"], pictures: ["p1", "p2"] },
        cellRuntimeProfiles: ["prompt", "image"].flatMap((testId) =>
          [1, 2].map((index) => ({
            testId,
            values: { questions: `q${index}`, pictures: `p${index}` },
            targetProfileId: "native-profile",
          })),
        ),
      },
    },
  }));
  const prepare = () =>
    prepareAppMapCombineCells({
      map,
      combine: map.combines.daily!,
      target: { targetId, platform: "android" },
      seed: 1000,
    });
  const prepared = await prepare();
  assert.equal(prepared.cells.length, 4);
  await freezeCombineRunInputs({ projectId, cells: prepared.cells, seed: 1000 });
  for (const cell of prepared.cells) {
    const index = Number(cell.values.questions!.slice(1)) - 1;
    assert.deepEqual(cell.values, { questions: `q${index + 1}`, pictures: `p${index + 1}` });
    assert.deepEqual(
      cell.runtimeInputs!.variables,
      cell.testId === "prompt"
        ? { chat_prompt: values[index] }
        : { image_prompt: imageValues[index] },
    );
    assert.deepEqual(cell.wrapperInputs, {});
  }
  await writeProjectVariables(projectId, {
    expectedRevision: 2,
    value: [definitions[0]!, { ...definitions[1]!, scope: "private", values: undefined }],
  });
  const rejected = await prepare();
  await assert.rejects(
    freezeCombineRunInputs({ projectId, cells: rejected.cells, seed: 1000 }),
    /public, non-sensitive/,
  );
  assert.ok(
    rejected.cells.every((cell) => !cell.runtimeInputs),
    "invalid even inapplicable input rows bind no cells",
  );
});

test("canonical selected-cell input approval ignores revoked unrequested rows and rejects requested ones before discovery", async (t) => {
  const projectId = "input-only-selected-cell";
  const { map, appMapId, targetId, values } = await nativeInputDataSetCombineFixture(projectId);
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.daily!,
    target: { targetId, platform: "android" },
    seed: 1000,
  });
  await writeProjectVariables(projectId, {
    expectedRevision: 1,
    value: [
      {
        id: "prompt-data",
        name: "chat_prompt",
        scope: "shared",
        source: "list",
        values: [values[0]!],
      },
    ],
  });
  let controls = 0;
  let discoveries = 0;
  t.mock.method(defaultJobRouteRuntime, "listDevices", async () => {
    discoveries++;
    return [];
  });
  t.mock.method(defaultJobRouteRuntime, "assertTargetControl", async () => {
    controls++;
    throw new Error("fixture selected control stop");
  });
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: "human:input-fixture",
    actorKind: "human",
  });
  const start = (cellId: string) =>
    client.invoke("job.combine.start", {
      appMapId,
      combineId: "daily",
      serial: targetId,
      targetKind: "device",
      platform: "android",
      seed: 1000,
      executionMode: "all",
      selectedCellIds: [cellId],
    });
  try {
    await assert.rejects(start(prepared.cells[0]!.cellId), /fixture selected control stop/);
    assert.equal(
      controls,
      1,
      "valid requested row reaches admission even though another row was revoked",
    );
    const discoveryCount = discoveries;
    await assert.rejects(start(prepared.cells[1]!.cellId), /approved Project input values/);
    await assert.rejects(start(`c${"a".repeat(32)}`), /available cells/);
    assert.equal(controls, 1);
    assert.equal(discoveries, discoveryCount, "bad selected scope stops before live discovery");
  } finally {
    await server.close();
  }
});
