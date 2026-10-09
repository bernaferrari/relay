import assert from "node:assert/strict";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { startServer } from "./index.js";

function clientFor(port: number): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "acme",
    projectId: "mobile",
    actorId: "human:author",
    actorKind: "human",
  });
}

test("a described Test drafts, saves, and compiles without a recording", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    const created = await client.invoke("app-map.create", { appMapId: "shop", name: "Shop" });
    const drafted = await client.invoke("app-map.test.draft", {
      appMapId: "shop",
      goal: "Open the cart\nVerify the cart shows 1 item",
      startUrl: "https://shop.example/",
    });
    assert.equal(drafted.source, "lines");
    assert.deepEqual(drafted.steps, [
      { kind: "instruction", intent: "Open the cart" },
      { kind: "validation", intent: "Verify the cart shows 1 item" },
    ]);

    await client.invoke("app-map.test.save", {
      appMapId: "shop",
      testId: "cart",
      expectedRevision: created.appMap.revision,
      test: {
        name: drafted.name,
        kind: "scenario",
        intentSchemaVersion: 1,
        startUrl: "https://shop.example/",
        steps: drafted.steps.map((step, index) => ({
          id: `step-${index + 1}`,
          ...step,
          binding: { status: "unresolved", reason: "Runs from text", fromText: true },
        })),
      },
    } as never);
    const compiled = await client.invoke("app-map.test.compile", {
      appMapId: "shop",
      testId: "cart",
    });
    const root = compiled.plan.recipes[compiled.plan.rootRecipeId]!;
    assert.deepEqual(
      root.steps.map((step) => step.kind),
      ["app", "act", "evaluate-visual"],
    );

    await assert.rejects(
      () => client.invoke("app-map.test.draft", { appMapId: "shop", goal: "   " } as never),
      /Describe what should work|goal/i,
    );
  } finally {
    await server.close();
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
