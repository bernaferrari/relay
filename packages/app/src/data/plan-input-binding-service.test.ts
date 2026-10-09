import { expect, it } from "vitest";
import { RelayClient } from "@relay/client";
import type { AppMap, AppMapScenarioTest, TestData } from "@relay/protocol";
import { createPlanInputDataSetService } from "./plan-input-data-set-service";

const scope = {
  organizationId: "local",
  projectId: "default",
  appMapId: "grok",
  createdAt: 1,
  updatedAt: 1,
};
const step = {
  id: "type-prompt",
  kind: "instruction" as const,
  intent: "Type prompt",
  binding: { status: "resolved" as const, kind: "connections" as const, connectionIds: ["prompt"] },
};
const test: AppMapScenarioTest = {
  ...scope,
  id: "fast",
  name: "Fast chat",
  kind: "scenario",
  intentSchemaVersion: 1,
  steps: [step],
};
const definition: TestData = {
  id: "public-prompt-id",
  name: "chat_prompt",
  scope: "shared",
  source: "list",
  values: ["  First prompt.\nKeep it intact.  ", "  First prompt.\nKeep it intact.  "],
};
function appMap(): AppMap {
  return {
    schemaVersion: 1,
    id: "grok",
    name: "Grok",
    organizationId: "local",
    projectId: "default",
    createdAt: 1,
    updatedAt: 1,
    revision: 4,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    caseStacks: {},
    variables: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    tests: {
      fast: structuredClone(test),
      other: { ...structuredClone(test), id: "other", name: "Other chat" },
    },
    connections: {
      prompt: {
        ...scope,
        id: "prompt",
        fromScreenId: "home",
        destination: { kind: "end" },
        state: "ready",
        label: "Prompt",
        actions: [
          {
            id: "recorded",
            kind: "recorded",
            takeId: "take",
            takeRevision: 12,
            evidenceIds: ["before", "after"],
            steps: [
              { id: "focus", kind: "tap", target: { identifier: "composer" } },
              {
                id: "type-leaf",
                kind: "type",
                text: "Original prompt",
                mode: "replace",
                target: { identifier: "composer" },
                evidence: {
                  id: "recorded-type-evidence",
                  recordedAt: 1,
                  screenshot: {
                    recipeId: "recorded-prompt",
                    id: "before",
                    capturedAt: 1,
                    mime: "image/png",
                  },
                },
              },
              { id: "send", kind: "tap", target: { identifier: "send" } },
            ],
          },
          { id: "wait", kind: "wait", ms: 10 },
        ],
      },
    },
  };
}
function fixture(map = appMap(), failWrite = false) {
  const requests: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const relay = new RelayClient(
    {
      url: "http://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:plan-binding",
      actorKind: "human",
    },
    {
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ method, path, body });
        if (method !== "GET" && failWrite)
          return new Response(
            JSON.stringify({ error: { message: "The app changed", code: "CONFLICT" } }),
            { status: 409 },
          );
        const result =
          path === "/project/variables"
            ? { revision: 2, updatedAt: 1, value: [definition] }
            : path === "/app-maps"
              ? { appMaps: [map] }
              : { appMap: method === "GET" ? map : { ...map, revision: 5 } };
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  const service = createPlanInputDataSetService(
    async () => relay,
    (saved) => ({
      appMapId: saved.id,
      appName: saved.name,
      revision: saved.revision,
      tests: [],
      dataSets: [],
    }),
  );
  return { service, requests, map };
}
const input = {
  appMapId: "grok",
  expectedRevision: 4,
  catalogRevision: 2,
  inputId: definition.id,
  name: "Chat prompts",
  testIds: ["fast"],
  selectedOptionIds: ["value-2"],
  bindings: [
    {
      testId: "fast",
      stepId: "type-prompt",
      actionKey: JSON.stringify(["prompt", "recorded", "type-leaf"]),
      text: "Original prompt",
    },
  ],
};

it("saves the Data set and only the chosen recorded text leaf through one real canonical commit", async () => {
  const { service, requests, map } = fixture();
  const before = structuredClone(map);
  const result = await service.addInputDataSet(input);
  const writes = requests.filter((request) => request.method !== "GET");
  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe("/app-maps/grok/commit");
  const actions = structuredClone(map.connections.prompt!.actions);
  const recorded = actions[0]!;
  if (recorded.kind !== "recorded") throw new Error("Expected recorded fixture");
  const leaf = recorded.steps[1]!;
  if (leaf.kind !== "type") throw new Error("Expected Type fixture");
  leaf.text = "{{public-prompt-id}}";
  expect(writes[0]!.body).toMatchObject({
    expectedRevision: 4,
    changes: [
      {
        kind: "variable.save",
        variable: {
          apply: { kind: "input", inputId: definition.id },
          options: [
            { id: "value-1", value: definition.values![0] },
            { id: "value-2", value: definition.values![1] },
          ],
        },
      },
      { kind: "connection.update", connectionId: "prompt", patch: { actions } },
    ],
  });
  expect(result).toMatchObject({ selectedOptionIds: ["value-2"], editor: { revision: 5 } });
  expect(map).toEqual(before);
});

it("refuses a stale addressed text leaf before any write", async () => {
  const { service, requests } = fixture();
  const stale = { ...input, bindings: [{ ...input.bindings[0]!, text: "Outdated prompt" }] };
  await expect(service.addInputDataSet(stale)).rejects.toThrow("text action changed");
  expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);
});

it("preserves the binding and row draft and sends a rejected commit once", async () => {
  const { service, requests } = fixture(appMap(), true);
  const draft = structuredClone(input);
  await expect(service.addInputDataSet(draft)).rejects.toThrow("app changed");
  expect(draft).toEqual(input);
  expect(requests.filter((request) => request.method !== "GET")).toHaveLength(1);
});

it("previews exact leaf addresses and every shared instruction, including another step in the same test", async () => {
  const map = appMap();
  map.tests.fast!.steps.push({ ...step, id: "again", intent: "Repeat prompt" });
  const { service, requests } = fixture(map);
  const preview = await service.previewInputBindings(input);
  expect(preview.tests[0]!.actions).toHaveLength(2);
  expect(preview.tests[0]!.actions[0]).toMatchObject({
    stepId: "type-prompt",
    recipeStepId: "type-leaf",
    text: "Original prompt",
    sharedTestNames: ["Other chat"],
    sharedSteps: [
      { testId: "fast", testName: "Fast chat", stepId: "again", stepTitle: "Repeat prompt" },
      { testId: "other", testName: "Other chat", stepId: "type-prompt", stepTitle: "Type prompt" },
    ],
  });
  expect(preview.options).toEqual([
    { id: "value-1", value: definition.values![0] },
    { id: "value-2", value: definition.values![1] },
  ]);
  expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);
});

it("binds an existing Data set in place and retains its real row IDs", async () => {
  const map = appMap();
  map.variables.existing = {
    ...scope,
    id: "existing",
    name: "Saved prompts",
    kind: "custom",
    apply: { kind: "input", inputId: definition.id },
    options: [
      { id: "row-left", value: definition.values![0] },
      { id: "row-right", value: definition.values![1] },
    ],
  };
  const { service, requests } = fixture(map);
  const result = await service.addInputDataSet({
    ...input,
    name: "",
    selectedOptionIds: ["row-right"],
  });
  expect(result).toMatchObject({ variableId: "existing", selectedOptionIds: ["row-right"] });
  const write = requests.filter((request) => request.method !== "GET")[0]!;
  expect(write.path).toBe("/app-maps/grok/commit");
  expect((write.body!.changes as { kind: string }[]).map((change) => change.kind)).toEqual([
    "connection.update",
  ]);
});

it.each([
  { change: { expectedRevision: 3 }, message: "app changed" },
  { change: { catalogRevision: 1 }, message: "saved values changed" },
  { change: { selectedOptionIds: ["missing-row"] }, message: "current saved value" },
  { change: { testIds: ["other"] }, message: "text action changed" },
])(
  "rejects stale or foreign binding choices before writing: $message",
  async ({ change, message }) => {
    const { service, requests } = fixture();
    await expect(service.addInputDataSet({ ...input, ...change })).rejects.toThrow(message);
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);
  },
);
