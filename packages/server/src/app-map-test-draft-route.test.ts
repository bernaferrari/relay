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

test("the observed map answers for an App with no runs yet", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    await client.invoke("app-map.create", { appMapId: "empty", name: "Empty" });
    const observed = await client.invoke("app-map.observed", { appMapId: "empty" });
    assert.deepEqual(observed, {
      appMapId: "empty",
      runsScanned: 0,
      screens: [],
      transitions: [],
      summary: { known: 0, tested: 0, failing: 0, new: 0 },
    });
  } finally {
    await server.close();
  }
});

test("the model key can be saved and removed but is never read back", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    await assert.rejects(
      () => client.invoke("system.model-key.set", { key: "nope" }),
      /does not look like an OpenRouter key/,
    );
    const saved = await client.invoke("system.model-key.set", {
      key: "sk-or-v1-test-0000000000000000000000",
    });
    assert.deepEqual(saved, { configured: true, source: "settings" });
    assert.equal(JSON.stringify(saved).includes("sk-or"), false);
    const removed = await client.invoke("system.model-key.set", { key: "" });
    assert.deepEqual(removed, { configured: false, source: "none" });
  } finally {
    await server.close();
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("a goal becomes a saved plain-English Test, creating the App for a new website", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    const created = await client.invoke("test.create-from-goal", {
      goal: "Open pricing\nVerify the Pro plan is listed",
      url: "https://www.shop.example/",
    });
    assert.equal(created.createdApp, true);
    assert.equal(created.appId, "shop-example");
    assert.deepEqual(created.steps, [
      { kind: "action", text: "Open pricing" },
      { kind: "check", text: "Verify the Pro plan is listed" },
    ]);
    const again = await client.invoke("test.create-from-goal", {
      goal: "Open the blog",
      app: "shop.example",
    });
    assert.equal(again.createdApp, false);
    assert.equal(again.appId, "shop-example");
    const compiled = await client.invoke("app-map.test.compile", {
      appMapId: created.appId,
      testId: created.testId,
    });
    const root = compiled.plan.recipes[compiled.plan.rootRecipeId]!;
    assert.deepEqual(
      root.steps.map((step) => step.kind),
      ["app", "act", "evaluate-visual"],
    );
    await assert.rejects(
      () => client.invoke("test.create-from-goal", { goal: "Open it", app: "nope" }),
      /No app named/,
    );
  } finally {
    await server.close();
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("a test file creates a Test, updates it in place, and exports again", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    const file = (step: string) =>
      `name: Pricing\nurl: https://docs.example/\nsteps:\n  - Open pricing\n  - check: ${step}\n`;
    const first = await client.invoke("test.apply-yaml", { yaml: file("Pro is listed") });
    assert.equal(first.created, true);
    assert.equal(first.createdApp, true);
    const second = await client.invoke("test.apply-yaml", { yaml: file("Team is listed") });
    assert.equal(second.created, false);
    assert.equal(second.testId, first.testId);
    const exported = await client.invoke("test.yaml.get", { testId: "Pricing" });
    assert.match(exported.yaml, /check: Team is listed/);
    assert.match(exported.yaml, /url: https:\/\/docs\.example\//);
    await assert.rejects(
      () => client.invoke("test.apply-yaml", { yaml: "name: x\nsteps: [a]" }),
      /app.*url/,
    );
  } finally {
    await server.close();
  }
});
