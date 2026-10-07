import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";
import { summarizeTargetOperationResult } from "./target-summary.js";

const resolution = {
  method: "label" as const,
  point: { x: 180, y: 185 },
  bounds: { x: 80, y: 160, width: 200, height: 50 },
};
const preview = {
  ok: true,
  preview: true,
  mime: "image/png",
  base64: "cG5n",
  bytes: 3,
  inspectable: true,
};

test("canonical interact parser preserves resolved and legacy preview selections", () => {
  for (const state of [undefined, "resolved"] as const) {
    const value = { ...preview, resolution, ...(state ? { resolutionState: state } : {}) };
    assert.deepEqual(operationDefinition("target.interact").output.parse(value), value);
  }
});
test("canonical interact parser preserves unmarked negative selection states", () => {
  for (const resolutionState of ["ambiguous", "unresolved", "unavailable"] as const) {
    const value = { ...preview, resolutionState };
    assert.deepEqual(operationDefinition("target.interact").output.parse(value), value);
  }
});
test("canonical interact parser rejects contradictory, malformed or nonfinite locations", () => {
  for (const selection of [
    { resolutionState: "resolved" },
    { resolutionState: "ambiguous", resolution },
    { resolutionState: "unavailable", resolution },
    { resolutionState: "invented" },
    { resolution: { ...resolution, point: { x: Infinity, y: 185 } } },
    { resolution: { ...resolution, bounds: { ...resolution.bounds, width: 0 } } },
  ])
    assert.throws(() =>
      operationDefinition("target.interact").output.parse({ ...preview, ...selection }),
    );
});
test("public preview digest retains paired state and strips raster and raw receipt", () => {
  const result = summarizeTargetOperationResult("target.interact", {
    ...preview,
    resolutionState: "resolved",
    resolution,
    selectorCandidateReceipt: { candidateCount: 1, appBundleId: "private" },
  }) as Record<string, unknown>;
  assert.equal(result.resolutionState, "resolved");
  assert.deepEqual(result.resolution, resolution);
  assert.equal(result.base64, undefined);
  assert.equal(result.selectorCandidateReceipt, undefined);
  const ambiguous = summarizeTargetOperationResult("target.interact", {
    ...preview,
    resolutionState: "ambiguous",
    resolution,
  }) as Record<string, unknown>;
  assert.equal(ambiguous.resolution, undefined);
  assert.equal(ambiguous.resolutionState, undefined);
});

test("negative or unproven preview summaries never encourage committing a tap", () => {
  for (const resolutionState of [undefined, "ambiguous", "unresolved", "unavailable"] as const) {
    const value = summarizeTargetOperationResult("target.interact", {
      ...preview,
      ...(resolutionState ? { resolutionState } : {}),
    }) as Record<string, unknown>;
    assert.doesNotMatch(String(value.nextHint), /preview:false|commit/i);
    if (resolutionState === "ambiguous") assert.match(String(value.nextHint), /unique identifier/);
    else assert.match(String(value.nextHint), /current screen/);
  }
});
