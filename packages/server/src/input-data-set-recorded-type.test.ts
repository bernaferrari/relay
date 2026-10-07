import assert from "node:assert/strict";
import test from "node:test";
import { RelayClient } from "@relay/client";
import {
  combineCampaignCaseFromPreparedCell,
  mutateStoredAppMap,
  observeScreenIdentity,
  parseAppMapCombineCellExecutionIntent,
  persistAuthoringEvidence,
  prepareAppMapCombineCells,
  readAppMap,
  runWithOperationContext,
  runWithTargetContext,
  stagePreparedAppMapCombineCells,
  writeProjectVariables,
  type PreparedAppMapCombineCell,
  type SnapshotNode,
} from "@relay/core";
import { runRecipeStep } from "@relay/core/recipe-runner";
import { deviceTestDouble } from "@relay/core/testing";
import type { ActionSpec, RecipeStep } from "@relay/protocol";
import {
  freezeCombineRunInputs,
  requireCombineRunInputs,
  restoreCombineRunInputs,
} from "./combine-run-inputs.js";
import { nativeInputDataSetCombineFixture } from "./native-combine-inputs-test-fixture.js";
import { startServer } from "./index.js";

test("recorded Type parameterization reaches frozen Plan rows and resumes their original text without extra taps", async () => {
  const projectId = "input-only-recorded-type";
  const fixture = await nativeInputDataSetCombineFixture(projectId, [
    "  Explain how a paper airplane flies.\n\n    Use three short sentences.\n",
    "Suggest a paper airplane tip",
  ]);
  // A synthetic CoreSimulator UUID keeps canonical text dispatch on the device
  // double. Android's real text helper deliberately uses host ADB.
  const targetId = "12345678-1234-1234-1234-123456789ABC";
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "TextField",
      identifier: "composer",
      label: "Composer",
      rect: { x: 10, y: 10, width: 300, height: 44 },
    },
  ];
  const observation = observeScreenIdentity(nodes);
  const tree = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: 1,
    mime: "application/json",
    data: JSON.stringify({ nodes }),
  });
  const originalType: Extract<RecipeStep, { kind: "type" }> = {
    id: "recorded-type-step",
    kind: "type",
    text: "The original recorded prompt",
  };
  const recorded: Extract<ActionSpec, { kind: "recorded" }> = {
    id: "recorded-prompt-action",
    kind: "recorded",
    takeId: "prompt-take",
    takeRevision: 1,
    evidenceIds: ["prompt-before", "prompt-after"],
    steps: [originalType],
  };
  const parameterized = { ...recorded, steps: [{ ...originalType, text: "{{chat_prompt}}" }] };
  const literalMap = await mutateStoredAppMap(projectId, fixture.appMapId, (current) => ({
    ...current,
    revision: current.revision + 1,
    screens: {
      home: {
        ...current.screens.home!,
        identity: { schemaVersion: 1, fingerprint: observation.fingerprint },
      },
    },
    screenVariants: {
      "home-native": {
        ...current.screenVariants["home-native"]!,
        targetProfile: {
          ...current.screenVariants["home-native"]!.targetProfile!,
          targetId,
          platform: "ios",
        },
        observation,
        evidenceIds: [tree.id],
        evidenceUris: [tree.uri],
        rawAccessibilityTree: {
          id: tree.id,
          uri: tree.uri,
          sha256: tree.sha256!,
          bytes: tree.bytes!,
          mime: "application/json",
          capturedAt: tree.capturedAt,
          observationId: "recorded-home-observation",
        },
      },
    },
    connections: {
      "recorded-prompt": {
        organizationId: current.organizationId,
        projectId,
        appMapId: current.id,
        createdAt: 1,
        updatedAt: 1,
        id: "recorded-prompt",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "home" },
        state: "ready",
        label: "Type the prompt",
        actions: [recorded],
        recordingSource: {
          schemaVersion: 1,
          takeId: recorded.takeId,
          takeRevision: recorded.takeRevision,
          evidenceIds: recorded.evidenceIds,
          capture: {
            schemaVersion: 1,
            provenance: { schemaVersion: 1, mode: "control-and-record", origin: "relay-control" },
            proof: "replay-proved",
          },
        },
      },
    },
    tests: {
      prompt: {
        ...current.tests.prompt!,
        kind: "scenario",
        intentSchemaVersion: 1,
        capture: { mode: "none" },
        steps: [
          {
            id: "prompt",
            kind: "instruction",
            intent: "Type the prompt",
            binding: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["recorded-prompt"],
            },
          },
        ],
      },
    },
  }));
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: "human:recorded-input-fixture",
    actorKind: "human",
  });
  try {
    const literal = await client.invoke("app-map.test.compile", {
      appMapId: fixture.appMapId,
      testId: "prompt",
      targetProfileId: "native-profile",
    });
    const typeSteps = (recipes: Record<string, { steps: readonly RecipeStep[] }>) =>
      Object.values(recipes).flatMap((recipe) =>
        recipe.steps.filter((step) => step.kind === "type"),
      );
    assert.deepEqual(typeSteps(literal.plan.recipes), recorded.steps);
    const changed = await client.invoke("app-map.connection.update", {
      appMapId: fixture.appMapId,
      connectionId: "recorded-prompt",
      expectedRevision: literalMap.revision,
      patch: { actions: [parameterized] },
    });
    const saved = changed.appMap;
    assert.deepEqual(saved.tests.prompt, literalMap.tests.prompt);
    assert.deepEqual(
      saved.connections["recorded-prompt"]!.recordingSource,
      literalMap.connections["recorded-prompt"]!.recordingSource,
    );
    assert.deepEqual(saved.connections["recorded-prompt"]!.actions, [parameterized]);
    const compiled = await client.invoke("app-map.test.compile", {
      appMapId: fixture.appMapId,
      testId: "prompt",
      targetProfileId: "native-profile",
    });
    assert.equal(
      compiled.preflight.summary.blockers,
      0,
      JSON.stringify(compiled.preflight.findings),
    );
    assert.deepEqual(typeSteps(compiled.plan.recipes), parameterized.steps);
    assert.ok(
      compiled.plan.stepProvenance.some(
        (source) =>
          source.testStepId === "prompt" &&
          source.recipeStepId === originalType.id &&
          source.referencedEntityIds.includes("recorded-prompt"),
      ),
    );
    const prepare = () =>
      prepareAppMapCombineCells({
        map: saved,
        combine: saved.combines.daily!,
        target: { targetId, platform: "ios" },
        seed: 1000,
      });
    const prepared = await prepare();
    await freezeCombineRunInputs({ projectId, cells: prepared.cells, seed: 1000 });
    const graph = structuredClone(prepared.cells[0]!.childIntent.recipeGraph);
    for (const cell of prepared.cells) {
      assert.deepEqual(cell.childIntent.recipeGraph, graph);
      assert.deepEqual(cell.wrapperInputs, {});
      assert.deepEqual(cell.recipeSnapshot.steps, [
        { kind: "module", recipeId: cell.childIntent.plan.rootRecipeId },
      ]);
      assert.ok(!Object.keys(cell.recipeGraph).some((id) => id.startsWith("__opt_")));
      assert.deepEqual(
        parseAppMapCombineCellExecutionIntent(cell.outerIntent)?.child.frozenInputs,
        cell.runtimeInputs!.receipt,
      );
    }
    const execute = async (cells: PreparedAppMapCombineCell[]) => {
      const typed: string[] = [];
      const device = deviceTestDouble({
        capture: { snapshot: async () => ({ nodes }) },
        interactions: {
          type: async (input: { text: string }) => {
            typed.push(input.text);
            return {};
          },
          press: async () => assert.fail("input-only Plan must not add a tap"),
        },
        command: { wait: async () => ({}) },
      });
      const staged = runWithOperationContext(
        {
          schemaVersion: 1,
          actorId: "human:recorded-input-fixture",
          actorKind: "human",
          organizationId: "local",
          projectId,
          operationId: "job.combine.start",
          requestId: "recorded-input-stage",
          idempotencyKey: "recorded-input-stage",
          issuedAt: 1,
        },
        () =>
          stagePreparedAppMapCombineCells({
            cells,
            projectId,
            targetForCell: (cell) => cell.executionTarget,
            queuedTargetProfile: () => saved.screenVariants["home-native"]!.targetProfile,
          }),
      );
      try {
        for (const [index, job] of staged.jobs.entries()) {
          assert.deepEqual(job.resolvedInputs, { chat_prompt: fixture.values[index] });
          assert.deepEqual(job.recipeGraph, cells[index]!.recipeGraph);
          const frozen = job.artifacts.find(
            (artifact) => artifact.kind === "app-map-combine-cell-execution-intent",
          );
          assert.deepEqual(
            parseAppMapCombineCellExecutionIntent(frozen?.data)?.child.frozenInputs,
            cells[index]!.runtimeInputs!.receipt,
          );
          await runWithTargetContext(
            { kind: "device", platform: "ios", serial: targetId },
            async () => {
              const context = { job, log: () => {}, recipeGraph: job.recipeGraph };
              for (const step of job.recipeSnapshot!.steps)
                await runRecipeStep(device, step, context);
            },
          );
          assert.deepEqual(typed, fixture.values.slice(0, index + 1));
        }
      } finally {
        staged.rollback();
      }
      return typed;
    };
    assert.deepEqual(await execute(prepared.cells), fixture.values);
    const cases = prepared.cells.map((cell, index) =>
      combineCampaignCaseFromPreparedCell(cell, { index, phase: "coverage", status: "pending" }),
    );
    await writeProjectVariables(projectId, {
      expectedRevision: 1,
      value: [
        {
          id: "prompt-data",
          name: "chat_prompt",
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
      restored.cells.map((cell) => cell.outerIntent.digest),
      prepared.cells.map((cell) => cell.outerIntent.digest),
    );
    assert.deepEqual(await execute(restored.cells), fixture.values);
    assert.deepEqual(
      await readAppMap(projectId, fixture.appMapId),
      saved,
      "execution must not rewrite recorded actions or evidence",
    );
  } finally {
    await server.close();
  }
});
