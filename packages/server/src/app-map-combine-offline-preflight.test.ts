import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import {
  appMapCombineCellId,
  createAppMap,
  listJobs,
  listRecipes,
  mutateStoredAppMap,
  observeScreenIdentity,
  persistAuthoringEvidence,
  readAppMap,
  resetControlDatabaseCache,
  writeProjectVariables,
  type SnapshotNode,
} from "@relay/core";
import type { CombineProfileTargetInput } from "@relay/protocol";
import { handleAppMapTestRoute } from "./app-map-test-routes.js";
import { HttpError, json } from "./http.js";
import { bindOperationRequest } from "./operations.js";
import type { RequestContext } from "./security.js";

const selector = "Quick responses · Grok 4.7";
const targetId = "offline-fixture-ipad";
const currentProfile = "saved-landscape";
const otherProfile = "saved-portrait";
const projectId = "plan-offline-http";
const appMapId = "grok-ios";
const combineId = "prompt-checks";
const prompts = ["Explain paper airplanes", "Explain ocean tides"];

async function capturedVariant(id: string, profileId: string, capturedSelector: boolean) {
  const viewport =
    profileId === currentProfile ? { width: 1112, height: 834 } : { width: 834, height: 1112 };
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Application",
      label: "Grok",
      rect: { x: 0, y: 0, ...viewport },
      logicalCoordinates: true,
    },
    {
      index: 1,
      parentIndex: 0,
      type: "Button",
      identifier: "toolbar.model.selector.button",
      label: "Auto",
      enabled: true,
      hittable: true,
      visibleToUser: true,
      rect: { x: 600, y: 30, width: 120, height: 44 },
      logicalCoordinates: true,
    },
    ...(capturedSelector
      ? [
          {
            index: 2,
            parentIndex: 0,
            type: "Button",
            label: selector,
            enabled: true,
            hittable: true,
            visibleToUser: true,
            rect: { x: 600, y: 130, width: 220, height: 54 },
            logicalCoordinates: true,
          },
        ]
      : []),
  ];
  const tree = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: 1,
    data: JSON.stringify({ nodes }),
    mime: "application/json",
  });
  return {
    id,
    organizationId: "local",
    projectId,
    appMapId,
    createdAt: 1,
    updatedAt: 1,
    screenId: "home",
    targetProfile: {
      id: profileId,
      targetId,
      platform: "ios" as const,
      source: "device" as const,
      name: "iPad",
      model: "Physical device",
      osVersion: "17.7.11",
      viewport,
      capabilities: ["snapshot" as const, "screenshot" as const],
      observedAt: 1,
    },
    observation: observeScreenIdentity(nodes),
    evidenceIds: [tree.id],
    evidenceUris: [tree.uri],
    rawAccessibilityTree: {
      id: tree.id,
      uri: tree.uri,
      sha256: tree.sha256!,
      bytes: tree.bytes!,
      mime: "application/json" as const,
      observationId: `${id}-observation`,
      capturedAt: 1,
    },
  };
}

async function savedFixture() {
  await writeProjectVariables(projectId, {
    expectedRevision: 0,
    value: [
      {
        id: "prompt-values",
        name: "chat_prompt",
        scope: "shared",
        source: "list",
        values: prompts,
      },
    ],
  });
  await createAppMap({ organizationId: "local", projectId, appMapId, name: "Grok iPad" });
  const current = await capturedVariant("current", currentProfile, false);
  const other = await capturedVariant("other", otherProfile, true);
  const entity = (id: string) => ({
    id,
    organizationId: "local",
    projectId,
    appMapId,
    createdAt: 1,
    updatedAt: 1,
  });
  return mutateStoredAppMap(projectId, appMapId, (map) => ({
    ...map,
    revision: map.revision + 1,
    screens: {
      home: {
        ...entity("home"),
        title: "Grok home",
        identity: { schemaVersion: 1, fingerprint: current.observation.fingerprint },
        variantIds: [current.id, other.id],
      },
    },
    screenVariants: { current, other },
    connections: {
      fast: {
        ...entity("fast"),
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "home" },
        state: "ready",
        actions: [
          {
            id: "choose-fast",
            kind: "steps",
            steps: [
              { id: "tap-fast", kind: "tap", target: { label: selector } },
              { id: "type-prompt", kind: "type", text: "{{chat_prompt}}" },
            ],
          },
        ],
      },
    },
    tests: {
      fast: {
        ...entity("fast"),
        name: "Fast completed response",
        kind: "scenario",
        intentSchemaVersion: 1,
        capture: { mode: "none" },
        steps: [
          {
            id: "choose-fast",
            kind: "instruction",
            intent: "Choose Fast",
            binding: { status: "resolved", kind: "connections", connectionIds: ["fast"] },
          },
        ],
      },
    },
    variables: {
      prompts: {
        ...entity("prompts"),
        name: "Chat prompts",
        kind: "custom",
        apply: { kind: "input", inputId: "prompt-values" },
        options: prompts.map((value, index) => ({ id: `q${index + 1}`, value })),
      },
    },
    combines: {
      [combineId]: {
        ...entity(combineId),
        name: "iPad prompt checks",
        variableIds: ["prompts"],
        testIds: ["fast"],
        strategy: "zip",
        selected: { prompts: ["q1", "q2"] },
        cellRuntimeProfiles: ["q1", "q2"].map((value) => ({
          testId: "fast",
          values: { prompts: value },
          targetProfileId: currentProfile,
        })),
      },
    },
  }));
}

test("Plan HTTP preflight reports both exact-profile selector blockers and forwards selected cases and columns", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-plan-offline-http-"));
  const previous = { state: process.env.RELAY_STATE_DIR, tests: process.env.RELAY_TESTS_DIR };
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  resetControlDatabaseCache();
  const scope: RequestContext = {
    subject: "human:preflight",
    organizationId: "local",
    projectId,
    allowedProjects: [projectId],
    tokenKind: "local",
    localTrusted: true,
    role: "admin",
  };
  let inventoryReads = 0;
  const columnsSeen: CombineProfileTargetInput[][] = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, "http://relay.local");
      const method = request.method ?? "GET";
      bindOperationRequest(request, response, method, url.pathname, url, scope);
      const handled = await handleAppMapTestRoute({
        method,
        pathname: url.pathname,
        request,
        response,
        scope,
        combinePreflightRuntime: {
          listDevices: async () => {
            inventoryReads += 1;
            return [
              {
                id: targetId,
                serial: targetId,
                name: "iPad",
                platform: "ios",
                kind: "physical",
                booted: true,
              },
            ];
          },
          preflightRequestedPlanColumnsAgainstWorkspace: async (input) => {
            columnsSeen.push(structuredClone([...input.profileTargets]));
            return [];
          },
        },
      });
      if (!handled) json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new RelayClient({
    url: `http://127.0.0.1:${address.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId,
    actorId: scope.subject,
    actorKind: "human",
  });
  const column: CombineProfileTargetInput = {
    profileId: "iPad",
    targetProfileId: currentProfile,
    target: { serial: targetId, platform: "ios", targetKind: "device" },
  };
  try {
    const map = await savedFixture();
    const storedBefore = await readAppMap(projectId, appMapId);
    const recipesBefore = await listRecipes();
    const jobsBefore = listJobs();
    const request = { appMapId, combineId, serial: targetId, profileTargets: [column] };
    const blocked = (await client.invoke("app-map.combine.preflight", request)).preflight;
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blockers.length, 2);
    assert.ok(
      blocked.cells.every((cell) => cell.binding === "bound" && cell.preflight === "blocked"),
    );
    assert.deepEqual(
      blocked.blockers.map((issue) => issue.values?.prompts),
      ["q1", "q2"],
    );
    assert.ok(
      blocked.blockers.every(
        (issue) =>
          issue.targetProfileId === currentProfile &&
          issue.testId === "fast" &&
          issue.message.includes("Choose Fast") &&
          issue.message.includes(selector),
      ),
    );
    assert.deepEqual(columnsSeen.at(-1), [column]);
    const selectedCellIds = [appMapCombineCellId("fast", { prompts: "q2" })];
    const pilot = (
      await client.invoke("app-map.combine.preflight", { ...request, selectedCellIds })
    ).preflight;
    assert.equal(pilot.blockers.length, 1);
    assert.equal(pilot.blockers[0]?.cellId, selectedCellIds[0]);
    const unknown = (
      await client.invoke("app-map.combine.preflight", {
        ...request,
        selectedCellIds: ["foreign-case"],
      })
    ).preflight;
    assert.equal(unknown.ok, false);
    assert.ok(unknown.blockers.some((issue) => issue.code === "foreign-binding"));
    const foreign = (
      await client.invoke("app-map.combine.preflight", {
        ...request,
        profileTargets: [{ ...column, target: { ...column.target, serial: "another-ipad" } }],
      })
    ).preflight;
    assert.equal(foreign.ok, false);
    assert.ok(foreign.blockers.some((issue) => issue.code === "mismatched-binding"));
    assert.deepEqual(
      await readAppMap(projectId, appMapId),
      storedBefore,
      "read-only preflight retains the saved Plan and evidence",
    );
    assert.deepEqual(await listRecipes(), recipesBefore, "no wrapper recipes are persisted");
    assert.deepEqual(listJobs(), jobsBefore, "no jobs are created");
    const repaired = await capturedVariant("current", currentProfile, true);
    await mutateStoredAppMap(projectId, appMapId, (current) => ({
      ...current,
      revision: current.revision + 1,
      screens: {
        ...current.screens,
        home: {
          ...current.screens.home!,
          identity: { schemaVersion: 1, fingerprint: repaired.observation.fingerprint },
        },
      },
      screenVariants: { ...current.screenVariants, current: repaired },
    }));
    const ready = (await client.invoke("app-map.combine.preflight", request)).preflight;
    assert.equal(ready.ok, true, JSON.stringify(ready.blockers));
    assert.ok(ready.cells.every((cell) => cell.binding === "bound" && cell.preflight === "ready"));
    assert.deepEqual(
      ready.cells.map((cell) => cell.cellId),
      blocked.cells.map((cell) => cell.cellId),
    );
    assert.equal(
      inventoryReads,
      5,
      "one injected passive inventory read per request; no host discovery",
    );
    assert.deepEqual(await listRecipes(), recipesBefore);
    assert.deepEqual(listJobs(), jobsBefore);
    assert.equal(map.combines[combineId]?.testIds[0], "fast");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    resetControlDatabaseCache();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});
