import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device-capabilities.js";
import { assertNonOverlappingLayout, LayoutAssertionError } from "./recipe-layout-assertion.js";
import { validateRecipeSteps } from "./recipe-validation.js";
import { runRecipeStep } from "./recipe-runner.js";
import { runWithTargetContext, type TargetContext } from "./target-context.js";

const first = { identifier: "description" };
const second = { identifier: "primary-action" };

function node(identifier: string, rect?: SnapshotNode["rect"]): SnapshotNode {
  return { identifier, role: "statictext", rect };
}

function device(nodes: SnapshotNode[]): Parameters<typeof runRecipeStep>[0] {
  return {
    capture: { snapshot: async () => ({ nodes }) },
    interactions: { find: async () => ({}) },
    command: { wait: async () => ({}) },
  } as unknown as Parameters<typeof runRecipeStep>[0];
}

test("layout recipes parse with semantic targets and reject point-only targets", () => {
  assert.deepEqual(
    validateRecipeSteps([
      { kind: "assert-layout", relation: "non-overlap", first, second, timeoutMs: 0 },
    ]),
    [{ kind: "assert-layout", relation: "non-overlap", first, second, timeoutMs: 0 }],
  );
  assert.throws(
    () =>
      validateRecipeSteps([
        {
          kind: "assert-layout",
          relation: "non-overlap",
          first: { point: { x: 10, y: 10 } },
          second,
        },
      ]),
    /assert-layout\.first requires identifier\/ref\/label\/text/u,
  );
  assert.throws(
    () =>
      validateRecipeSteps([
        {
          kind: "assert-layout",
          relation: "non-overlap",
          first: { relation: { kind: "following-row", anchor: { label: "Description" } } },
          second,
        },
      ]),
    /activation-only relation/u,
  );
});

test("layout assertion passes for disjoint bounds and reports overlap", () => {
  const result = assertNonOverlappingLayout(
    [
      node("description", { x: 10, y: 10, width: 80, height: 20 }),
      node("primary-action", { x: 10, y: 40, width: 80, height: 20 }),
    ],
    { first, second },
  );
  assert.equal(result.overlap, null);
  assert.equal(result.first.bounds.y, 10);

  assert.throws(
    () =>
      assertNonOverlappingLayout(
        [
          node("description", { x: 10, y: 10, width: 80, height: 40 }),
          node("primary-action", { x: 10, y: 30, width: 80, height: 20 }),
        ],
        { first, second },
      ),
    (error) =>
      error instanceof LayoutAssertionError &&
      error.code === "overlap" &&
      /overlaps/u.test(error.message),
  );
});

test("layout assertion fails closed when bounds are missing or ambiguous", () => {
  assert.throws(
    () => assertNonOverlappingLayout([node("description")], { first, second }),
    (error) => error instanceof LayoutAssertionError && error.code === "unavailable",
  );
  assert.throws(
    () =>
      assertNonOverlappingLayout(
        [
          node("description", { x: 0, y: 0, width: 20, height: 20 }),
          node("description", { x: 30, y: 0, width: 20, height: 20 }),
          node("primary-action", { x: 0, y: 40, width: 20, height: 20 }),
        ],
        { first, second },
      ),
    (error) => error instanceof LayoutAssertionError && error.code === "ambiguous",
  );
});

test("the canonical runner applies the same bounds assertion on Android and managed browser", async () => {
  const step = {
    kind: "assert-layout" as const,
    relation: "non-overlap" as const,
    first,
    second,
    timeoutMs: 0,
  };
  const nodes = [
    node("description", { x: 0, y: 0, width: 80, height: 20 }),
    node("primary-action", { x: 0, y: 30, width: 80, height: 20 }),
  ];
  for (const context of [
    { kind: "device", platform: "android", serial: "emulator-test" },
    { kind: "browser", platform: "browser", targetId: "managed-test" },
  ] satisfies TargetContext[]) {
    const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
    await runWithTargetContext(context, () =>
      runRecipeStep(device(nodes), step, { log: () => {}, artifacts }),
    );
    const artifact = artifacts.at(-1);
    assert.equal(artifact?.kind, "layout-assertion");
    assert.equal((artifact?.data as { passed: boolean } | undefined)?.passed, true);
  }

  for (const context of [
    { kind: "device", platform: "android", serial: "emulator-test" },
    { kind: "browser", platform: "browser", targetId: "managed-test" },
  ] satisfies TargetContext[]) {
    const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
    await assert.rejects(
      runWithTargetContext(context, () =>
        runRecipeStep(
          device([
            node("description", { x: 0, y: 0, width: 80, height: 40 }),
            node("primary-action", { x: 0, y: 20, width: 80, height: 20 }),
          ]),
          step,
          { log: () => {}, artifacts },
        ),
      ),
      /overlaps/u,
    );
    const overlapArtifact = artifacts.at(-1);
    assert.equal(overlapArtifact?.kind, "layout-assertion");
    assert.equal((overlapArtifact?.data as { passed: boolean } | undefined)?.passed, false);

    const missingArtifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
    await assert.rejects(
      runWithTargetContext(context, () =>
        runRecipeStep(device([node("description", { x: 0, y: 0, width: 80, height: 20 })]), step, {
          log: () => {},
          artifacts: missingArtifacts,
        }),
      ),
      /no visible element with bounds/u,
    );
    const missingArtifact = missingArtifacts.at(-1);
    assert.equal(missingArtifact?.kind, "layout-assertion");
    assert.equal((missingArtifact?.data as { passed: boolean } | undefined)?.passed, false);
  }
});
