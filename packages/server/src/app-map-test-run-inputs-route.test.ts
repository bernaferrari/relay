import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import type { EnqueueJobInput, TestJob } from "@relay/core";
import { startServer } from "./index.js";

test("saved Test route resolves prompts before discovery and queues the exact frozen values", async () => {
  const calls: string[] = [];
  let queued: EnqueueJobInput | undefined;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    appMapTestRunRuntime: {
      readProjectVariables: async () => {
        calls.push("inputs");
        return { revision: 4, updatedAt: 1, value: [] };
      },
      listDevices: async () => {
        calls.push("discover");
        return [
          {
            id: "pixel",
            serial: "pixel",
            name: "Fixture",
            kind: "Physical device",
            platform: "android",
            booted: true,
          },
        ];
      },
      assertTargetControl: async () => {
        calls.push("control");
        return undefined as never;
      },
      enqueueJob: (input) => {
        calls.push("queue");
        queued = input;
        return { id: "fixture-job", status: "queued", resolvedInputs: input.variables } as TestJob;
      },
    },
  });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    projectId: "prompt-route",
    organizationId: "local",
    actorId: "agent:prompt-route-test",
    actorKind: "agent",
  });
  try {
    await client.invoke("app-map.create", { appMapId: "chat", name: "Chat" });
    const saved = await client.invoke("app-map.test.save", {
      appMapId: "chat",
      testId: "prompt",
      expectedRevision: 0,
      test: {
        name: "Prompt",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "prompt",
            kind: "script",
            intent: "Use input",
            binding: { status: "resolved", kind: "script", source: 'return "{{chat_prompt}}";' },
          },
        ],
      },
    });
    const input = {
      appMapId: "chat",
      testId: "prompt",
      expectedRevision: saved.appMap.revision,
      target: { kind: "device" as const, platform: "android" as const, targetId: "pixel" },
    };
    await assert.rejects(
      client.invoke("app-map.test.run", input),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: string }).code === "missing-variable",
    );
    assert.deepEqual(calls, ["inputs"]);
    calls.length = 0;
    await client.invoke("app-map.test.run", {
      ...input,
      variables: { chat_prompt: "A different question", unrelated: "ignored" },
    });
    assert.equal(calls[0], "inputs");
    assert.ok(calls.indexOf("control") > calls.indexOf("inputs"));
    assert.equal(calls.at(-1), "queue");
    assert.deepEqual(queued?.variables, { chat_prompt: "A different question" });
    assert.ok(queued?.artifacts?.some((artifact) => artifact.kind === "frozen-inputs"));
    const source = JSON.stringify(queued?.recipeGraph);
    assert.ok(source.includes("{{chat_prompt}}"));
    assert.ok(!source.includes("A different question"));
  } finally {
    await server.close();
  }
});
