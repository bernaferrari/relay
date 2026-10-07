import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, RelayClient } from "@relay/client";
import {
  getJob,
  listJobs,
  mutateStoredAppMap,
  observeScreenIdentity,
  persistAuthoringEvidence,
  readAppMap,
  readPersistedRun,
  waitForJobCompletion,
} from "@relay/core";
import type { CombineCampaign, DeviceLease, FrozenRecipeInputReceipt } from "@relay/protocol";
import { nativeInputDataSetCombineFixture } from "./native-combine-inputs-test-fixture.js";
import {
  appBundleId,
  forbiddenInputs,
  holdTypeUntil,
  nodes,
  targetId,
  typed,
} from "./combine-frozen-input-sdk.js";
import { startServer } from "./index.js";

const projectId = "frozen-dispatch-project";
const values = [
  "  First prompt\nwith preserved spacing.\n",
  "Second prompt — a different public value",
];
const newValues = ["New first prompt", "New second prompt"];
const root = process.env.RELAY_FROZEN_INPUT_FIXTURE_ROOT;
assert.ok(root, "the fixture must have an isolated state directory");
const proofPath = join(root, "admission-proof.json");
type Proof = {
  batchId: string;
  firstJobId: string;
  cellIds: string[];
  receipts: FrozenRecipeInputReceipt[];
  mapRevision: number;
};

function definition(prompts: string[]) {
  return {
    id: "prompt-data",
    name: "chat_prompt",
    scope: "shared" as const,
    source: "list" as const,
    values: prompts,
  };
}

async function createTypeMap() {
  const fixture = await nativeInputDataSetCombineFixture(projectId, values);
  const observation = observeScreenIdentity(nodes);
  const tree = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: 1,
    mime: "application/json",
    data: JSON.stringify({ nodes }),
  });
  return mutateStoredAppMap(projectId, fixture.appMapId, (current) => ({
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
          observationId: "input-fixture-home",
        },
      },
    },
    connections: {
      prompt: {
        organizationId: current.organizationId,
        projectId,
        appMapId: current.id,
        id: "prompt",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "home" },
        state: "ready",
        label: "Type prompt",
        createdAt: 1,
        updatedAt: 1,
        // Deliberately authored steps: no invented recording Take or proof.
        actions: [
          {
            id: "prompt-action",
            kind: "steps",
            steps: [{ id: "type-prompt", kind: "type", text: "{{chat_prompt}}" }],
          },
        ],
      },
    },
    tests: {
      prompt: {
        ...current.tests.prompt!,
        originApplication: appBundleId,
        capture: { mode: "none" },
        steps: [
          {
            id: "prompt",
            kind: "instruction",
            intent: "Type prompt",
            binding: { status: "resolved", kind: "connections", connectionIds: ["prompt"] },
          },
        ],
      },
    },
  }));
}

async function startFixtureServer() {
  return startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      listDevices: async () => [
        {
          id: targetId,
          serial: targetId,
          name: "Frozen input simulator",
          kind: "Simulator",
          booted: true,
          platform: "ios",
        },
      ],
      assertTargetControl: async (): Promise<DeviceLease> => ({
        id: "fixture-lease",
        organizationId: "local",
        projectId,
        poolId: "local",
        deviceSerial: targetId,
        ownerId: "human:frozen-input-fixture",
        controlScope: "local-project",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
    },
  });
}
function clientFor(port: number) {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: "human:frozen-input-fixture",
    actorKind: "human",
  });
}
const startInput = {
  appMapId: "chat",
  combineId: "daily",
  targetKind: "device" as const,
  serial: targetId,
  platform: "ios" as const,
  strategy: "zip" as const,
  seed: 1000,
};

async function assertCompletedType(id: string, value: string, receipt: FrozenRecipeInputReceipt) {
  const job = await waitForJobCompletion(id);
  assert.equal(job.status, "ok", job.error ?? job.logs.join("\n"));
  const persisted = await readPersistedRun(id);
  assert.ok(persisted, "actual scheduler execution must commit an immutable Run");
  assert.deepEqual(persisted.resolvedInputs, { chat_prompt: value });
  const typeAttempts = persisted.artifacts
    .filter((artifact) => artifact.kind === "command-attempt")
    .flatMap((artifact) => {
      const data = artifact.data as { command?: { kind?: string; id?: string; text?: string } };
      return data.command?.kind === "type" ? [data.command] : [];
    });
  assert.deepEqual(typeAttempts, [{ id: "type-prompt", kind: "type", text: value }]);
  const intent = persisted.artifacts.find(
    (artifact) => artifact.kind === "app-map-combine-cell-execution-intent",
  );
  const data = intent?.data as { child?: { frozenInputs?: FrozenRecipeInputReceipt } } | undefined;
  assert.deepEqual(data?.child?.frozenInputs, receipt);
  assert.deepEqual(forbiddenInputs, [], "input-only rows may not dispatch picker taps or settings");
}

async function admit() {
  const map = await createTypeMap();
  const server = await startFixtureServer();
  let releaseType!: () => void;
  holdTypeUntil(
    new Promise<void>((resolve) => {
      releaseType = resolve;
    }),
  );
  try {
    const client = clientFor(server.port);
    const admitted = await client.invoke("job.combine.start", startInput);
    assert.equal(
      admitted.jobs.length,
      1,
      "default pilot leaves the second frozen case outstanding",
    );
    const campaign = admitted.campaign as CombineCampaign;
    assert.equal(campaign.cases.length, 2);
    const receipts = campaign.cases.map((item) => {
      assert.ok(item.frozenInputs);
      return item.frozenInputs;
    });
    assert.deepEqual(
      receipts.map((receipt) => receipt.values),
      values.map((chat_prompt) => ({ chat_prompt })),
    );
    assert.notEqual(receipts[0]!.valuesDigest, receipts[1]!.valuesDigest);
    assert.deepEqual(typed, [], "the Type boundary is held until the post-enqueue edit");
    await client.invoke("workspace.variables.update", {
      expectedRevision: 1,
      value: [definition(newValues)],
    });
    releaseType();
    const firstJobId = admitted.jobs[0]!.id;
    await assertCompletedType(firstJobId, values[0]!, receipts[0]!);
    const projected = (await client.invoke("job.combine.campaign.get", { batchId: campaign.id }))
      .campaign as CombineCampaign;
    assert.equal(projected.status, "ready-to-resume");
    assert.deepEqual(
      projected.cases.map((item) => item.status),
      ["passed", "pending"],
    );
    const afterRun = await readAppMap(projectId, map.id);
    assert.ok(afterRun);
    assert.deepEqual(
      afterRun.connections,
      map.connections,
      "Run projection cannot change authored actions",
    );
    const proof: Proof = {
      batchId: campaign.id,
      firstJobId,
      cellIds: campaign.cases.map((item) => item.cellId),
      receipts,
      mapRevision: afterRun.revision,
    };
    await writeFile(proofPath, JSON.stringify(proof));
    console.log(
      `FIXTURE_RESULT ${JSON.stringify({ pid: process.pid, typed, pending: 1, rejected: [] })}`,
    );
  } finally {
    releaseType();
    await server.close();
  }
}

async function resume() {
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  const server = await startFixtureServer();
  try {
    const client = clientFor(server.port);
    assert.equal(
      getJob(proof.firstJobId),
      undefined,
      "this process cannot borrow the old in-memory job",
    );
    assert.deepEqual(typed, [], "startup never automatically repeats input");
    assert.deepEqual((await readPersistedRun(proof.firstJobId))?.resolvedInputs, {
      chat_prompt: values[0],
    });
    const before = (await client.invoke("job.combine.campaign.get", { batchId: proof.batchId }))
      .campaign as CombineCampaign;
    assert.equal(before.status, "ready-to-resume");
    assert.deepEqual(
      before.cases.map((item) => item.frozenInputs),
      proof.receipts,
    );
    const currentMap = await readAppMap(projectId, "chat");
    assert.ok(currentMap);
    const result = await client.invoke("job.combine.campaign.resume", {
      batchId: proof.batchId,
      expectedAppMapRevision: proof.mapRevision,
    });
    assert.equal(result.jobs.length, 1);
    await assertCompletedType(result.jobs[0]!.id, values[1]!, proof.receipts[1]!);
    assert.deepEqual(typed, [values[1]]);
    const noOp = await client.invoke("job.combine.campaign.resume", { batchId: proof.batchId });
    assert.equal(
      noOp.jobs.length,
      0,
      "a completed campaign cannot automatically repeat either row",
    );
    const rejectWithoutDispatch = async (selection: string[], errorPattern: RegExp) => {
      const jobCount = listJobs().length;
      const inputCount = typed.length;
      await assert.rejects(
        client.invoke("job.combine.start", {
          ...startInput,
          executionMode: "all",
          selectedCellIds: selection,
        }),
        (error: unknown) =>
          error instanceof ApiError && error.status === 409 && errorPattern.test(error.message),
      );
      assert.equal(listJobs().length, jobCount);
      assert.equal(typed.length, inputCount);
    };
    await rejectWithoutDispatch([proof.cellIds[1]!], /approved Project input values/);
    await rejectWithoutDispatch([`c${"a".repeat(32)}`], /available cells/);
    await client.invoke("workspace.variables.update", { expectedRevision: 2, value: [] });
    await rejectWithoutDispatch([proof.cellIds[0]!], /Project input|Data set|input/);
    await client.invoke("workspace.variables.update", {
      expectedRevision: 3,
      value: [definition(newValues)],
    });
    const map = await readAppMap(projectId, "chat");
    assert.ok(map);
    const saved = await client.invoke("app-map.variable.save", {
      appMapId: "chat",
      variableId: "questions",
      expectedRevision: map.revision,
      variable: {
        ...map.variables.questions!,
        options: newValues.map((value, index) => ({ id: `q${index + 1}`, value })),
      },
    });
    assert.deepEqual(saved.appMap.connections, map.connections);
    assert.deepEqual(saved.appMap.tests, map.tests);
    const updated = await client.invoke("job.combine.start", {
      ...startInput,
      executionMode: "all",
    });
    assert.equal(updated.jobs.length, 2);
    const campaign = updated.campaign as CombineCampaign;
    for (const [index, job] of updated.jobs.entries())
      await assertCompletedType(job.id, newValues[index]!, campaign.cases[index]!.frozenInputs!);
    assert.deepEqual(typed, [values[1], ...newValues]);
    console.log(
      `FIXTURE_RESULT ${JSON.stringify({
        pid: process.pid,
        typed,
        pending: 0,
        rejected: ["retired-row", "unknown-cell", "missing-input"],
      })}`,
    );
  } finally {
    await server.close();
  }
}

async function rejectChangedMap(reason: string) {
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  const server = await startFixtureServer();
  try {
    const client = clientFor(server.port);
    const map = await readAppMap(projectId, "chat");
    assert.ok(map);
    if (reason === "authored") {
      await client.invoke("app-map.connection.update", {
        appMapId: "chat",
        connectionId: "prompt",
        expectedRevision: map.revision,
        patch: {
          actions: [
            {
              id: "prompt-action",
              kind: "steps",
              steps: [{ id: "type-prompt", kind: "type", text: "Changed authored text" }],
            },
          ],
        },
      });
    } else {
      await mutateStoredAppMap(projectId, "chat", (current) => {
        const changed = structuredClone(current);
        changed.revision += 1;
        if (reason !== "gap" && reason !== "timestamp") {
          // A corrupt fixture cannot bypass exact profile/CAS comparison by
          // pretending its edit was another validation-only projection.
          const event = Object.values(current.activity).find(
            (item) => item.eventType === "test.validated",
          );
          assert.ok(event);
          changed.activity["test-validated-corrupt-fixture"] = {
            ...event,
            id: "test-validated-corrupt-fixture",
            beforeRevision: current.revision,
            afterRevision: changed.revision,
          };
        }
        if (reason === "profile")
          changed.screenVariants["home-native"]!.targetProfile.capabilities.push("screenshot");
        else if (reason === "cas") {
          const variant = changed.screenVariants["home-native"]!;
          const tree = variant.rawAccessibilityTree!;
          const previousUri = tree.uri;
          tree.sha256 = "0".repeat(64);
          tree.uri = `relay-evidence://${tree.sha256}`;
          variant.evidenceUris = variant.evidenceUris!.map((uri) =>
            uri === previousUri ? tree.uri : uri,
          );
        } else if (reason === "timestamp") changed.updatedAt += 1000;
        else assert.equal(reason, "gap");
        return changed;
      });
    }
    await assert.rejects(
      client.invoke("job.combine.campaign.resume", { batchId: proof.batchId }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
      reason,
    );
    assert.equal(listJobs().length, 0, `${reason} cannot enqueue a job`);
    assert.deepEqual(typed, [], `${reason} cannot dispatch input`);
    console.log(
      `FIXTURE_RESULT ${JSON.stringify({ pid: process.pid, typed, pending: 1, rejected: [reason] })}`,
    );
  } finally {
    await server.close();
  }
}

if (process.argv[2] === "admit") await admit();
else if (process.argv[2] === "resume") await resume();
else if (process.argv[2]?.startsWith("reject-")) await rejectChangedMap(process.argv[2].slice(7));
else throw new Error("Expected an isolated fixture phase");
