import assert from "node:assert/strict";
import test from "node:test";
import { parseTestYaml, stepsFromYaml, testToYaml, TestYamlError } from "./test-yaml.js";

test("a test file is name, website, and plain steps", () => {
  const parsed = parseTestYaml(`
name: Create an API key
url: https://shop.example/settings
steps:
  - Open the API keys page
  - do: Create a new API key
  - check: The new key is listed
`);
  assert.deepEqual(parsed, {
    name: "Create an API key",
    url: "https://shop.example/settings",
    steps: [
      { kind: "instruction", intent: "Open the API keys page" },
      { kind: "instruction", intent: "Create a new API key" },
      { kind: "validation", intent: "The new key is listed" },
    ],
  });
});

test("mistakes name the field to fix", () => {
  const rejects = (source: string, pattern: RegExp) =>
    assert.throws(
      () => parseTestYaml(source),
      (error) => error instanceof TestYamlError && pattern.test(error.message),
    );
  rejects("steps: [a]\napp: shop", /`name`/);
  rejects("name: x\nsteps: [a]", /app.*url/);
  rejects("name: x\napp: shop\nsteps: []", /at least one step/);
  rejects("name: x\napp: shop\nsteps: [{ verify: y }]", /Step 1/);
  rejects("name: x\napp: shop\nsteps: [a]\ndevice: ios", /Unknown field `device`/);
  rejects("name: x\nurl: shop.example\nsteps: [a]", /http/);
});

test("editing the file keeps recorded steps whose words did not change", () => {
  const recorded = {
    id: "s1",
    kind: "instruction",
    intent: "Open the API keys page",
    binding: { status: "resolved", kind: "connections", connectionIds: ["c1"] },
  } as never;
  const steps = stepsFromYaml(
    "t",
    [
      { kind: "instruction", intent: "Open the API keys page" },
      { kind: "validation", intent: "The key is listed" },
    ],
    [recorded],
  );
  assert.equal(steps[0], recorded);
  assert.equal(steps[1]!.binding.status, "unresolved");
  assert.equal((steps[1]!.binding as { fromText?: boolean }).fromText, true);
});

test("editing unrelated steps preserves saved paths on steps whose words did not change", () => {
  const cache = {
    schemaVersion: 2,
    steps: [{ kind: "tap", target: { label: "Cart" } }],
    runId: "run-1",
    savedAt: 1,
    targetKind: "browser",
    resolution: [{ strategy: "label", key: "Cart" }],
    verification: { runOutcome: "passed" },
  };
  const saved = {
    id: "s1",
    kind: "instruction",
    intent: "Open the API keys page",
    binding: { status: "unresolved", reason: "x", fromText: true, cache },
  } as never;
  const other = {
    id: "s2",
    kind: "instruction",
    intent: "Create a key",
    binding: { status: "unresolved", reason: "x", fromText: true },
  } as never;
  const steps = stepsFromYaml(
    "t",
    [
      { kind: "instruction", intent: "Open the API keys page" },
      { kind: "instruction", intent: "Create a key with a new name" },
    ],
    [saved, other],
  );
  // The unchanged step is reused verbatim, saved path and all; the edited one
  // runs from its new words without the old step's work.
  assert.equal(steps[0], saved);
  assert.deepEqual((steps[0] as { binding?: { cache?: unknown } }).binding?.cache, cache);
  assert.equal((steps[1]!.binding as { cache?: unknown }).cache, undefined);
});

test("a saved Test round-trips through its file", () => {
  const yaml = testToYaml(
    {
      name: "Checkout",
      startUrl: "https://shop.example/",
      steps: [
        {
          id: "a",
          kind: "instruction",
          intent: "Add a shirt",
          binding: { status: "unresolved", reason: "x" },
        },
        {
          id: "b",
          kind: "validation",
          intent: "The cart shows 1 item",
          binding: { status: "unresolved", reason: "x" },
        },
      ],
    } as never,
    "shop.example",
    "checkout",
  );
  assert.deepEqual(parseTestYaml(yaml), {
    name: "Checkout",
    id: "checkout",
    url: "https://shop.example/",
    steps: [
      { kind: "instruction", intent: "Add a shirt" },
      { kind: "validation", intent: "The cart shows 1 item" },
    ],
  });
});
