import assert from "node:assert/strict";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS } from "@relay/protocol";
import {
  enqueueAppMapFlow,
  enqueueOptionMatrix,
  inferVariableRemote,
  removeCombineRemote,
  removeVariableRemote,
} from "./server-combine-remote";

type TransportStub = <T>(path: string, init?: RequestInit) => Promise<T>;

function clientFor(stub: TransportStub): RelayClient {
  return new RelayClient(
    {
      url: "http://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) =>
        new Response(JSON.stringify(await stub(new URL(String(input)).pathname, init)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  );
}

test("Combine and Variable removal use revision-checked App Map actions", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const client = clientFor(async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { appMap: { revision: 8 } } as T;
  });
  await removeCombineRemote(client, {
    appMapId: "map/a",
    combineId: "language × settings",
    expectedRevision: 6,
  });
  await removeVariableRemote(client, {
    appMapId: "map/a",
    variableId: "language/locale",
    expectedRevision: 7,
  });
  assert.deepEqual(
    calls.map(({ path, init }) => ({ path, body: JSON.parse(String(init?.body)) })),
    [
      {
        path: "/app-maps/map%2Fa/combines/language%20%C3%97%20settings/remove",
        body: { expectedRevision: 6 },
      },
      {
        path: "/app-maps/map%2Fa/variables/language%2Flocale/remove",
        body: { expectedRevision: 7 },
      },
    ],
  );
});

test("a run-to-screen request keeps its explicit flow boundary", async () => {
  let requestBody: unknown;
  await assert.rejects(
    enqueueAppMapFlow(
      clientFor(async <T>(_path: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return { job: { id: "job-1" }, jobs: [{ id: "job-1" }] } as T;
      }),
      {
        appMapId: "map-1",
        flowId: "main",
        throughConnectionId: "open-settings",
        serial: "phone-1",
        targetKind: "device",
        platform: "android",
      },
    ),
    /invalid response/,
  );
  assert.deepEqual(requestBody, {
    throughConnectionId: "open-settings",
    serial: "phone-1",
    targetKind: "device",
    platform: "android",
  });
});

test("Variable teaching uses the typed App Map operation and never sends a raw tree", async () => {
  let request: { path: string; body: Record<string, unknown> } | undefined;
  await inferVariableRemote(
    clientFor(async <T>(path: string, init?: RequestInit) => {
      request = { path, body: JSON.parse(String(init?.body)) };
      return {
        appMapId: "settings",
        expectedRevision: 2,
        capturedAt: 10,
        variable: { id: "language" },
        mutation: { operationId: "app-map.variable.save", input: {} },
      } as T;
    }),
    {
      appMapId: "settings",
      variableId: "language",
      expectedRevision: 2,
      target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      leaseId: "lease-1",
      taughtRows: [{ id: "en", identifier: "language.en" }],
    },
  );
  assert.equal(request?.path, "/app-maps/settings/variables/language/infer");
  assert.deepEqual(request?.body, {
    expectedRevision: 2,
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
    leaseId: "lease-1",
    taughtRows: [{ id: "en", identifier: "language.en" }],
  });
  assert.equal("nodes" in request!.body, false);
});

test("explicit local Combine transport never falls back to a selected serial", async () => {
  let body: Record<string, unknown> | undefined;
  await assert.rejects(
    enqueueOptionMatrix(
      clientFor(async <T>(_path: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return { batch: { id: "batch-1" }, jobs: [], matrix: { id: "batch-1" } } as T;
      }),
      {
        appMapId: "map-1",
        combineId: "language-settings",
        cellTargetBindings: [
          {
            testId: "settings",
            values: { language: "it" },
            target: {
              schemaVersion: 1,
              kind: "local-device",
              provider: { key: "relay.local.agent-device", scope: "local" },
              targetId: "pixel-1",
              platform: "android",
              identity: { kind: "device-serial", value: "pixel-1" },
            },
          },
        ],
        localAdmission: {
          deadlineMs: 180_000,
          durationEvidence: [
            {
              schemaVersion: 1,
              cohort: {
                targetId: "pixel-1",
                platform: "android",
                testId: "settings",
                action: "app-map:settings:test:settings",
              },
              duration: {
                workItemDurationMs: 12_000,
                provenance: "observed-p95",
                observedAt: 100,
                sampleCount: 5,
                maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
              },
              measurement: {
                estimator: "campaign-duration-estimate",
                recordSource: "persisted-runs",
                durationSource: "run-wall-clock",
                sampleIds: ["1", "2", "3", "4", "5"],
                observationWindow: { startedAt: 1, finishedAt: 100 },
              },
            },
          ],
        },
      },
    ),
    /invalid response/,
  );
  assert.equal(body?.serial, undefined);
  assert.equal(body?.browserTargetId, undefined);
  assert.equal((body?.cellTargetBindings as unknown[]).length, 1);
});
