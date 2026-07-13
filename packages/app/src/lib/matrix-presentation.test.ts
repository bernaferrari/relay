import assert from "node:assert/strict";
import test from "node:test";
import type { MatrixExpansion, TargetProfile } from "@relay/protocol";
import { matrixRunPreview } from "./matrix-presentation";

const target = (id: string, name: string): TargetProfile => ({
  id,
  targetId: id,
  source: "device",
  platform: "ios",
  name,
  capabilities: [],
  observedAt: 1,
});

test("summarizes the exact environment × trial expansion", () => {
  const expansion: MatrixExpansion = {
    matrixId: "release",
    matrixName: "Release devices",
    resolvedAt: 1,
    profiles: [target("iphone-15", "iPhone 15"), target("iphone-16", "iPhone 16")],
    excluded: [],
  };
  assert.equal(matrixRunPreview(expansion, 3).summary, "2 environments · 3 trials · 6 runs");
  assert.deepEqual(matrixRunPreview(expansion, 3).profiles, [
    { name: "iPhone 15", platform: "ios" },
    { name: "iPhone 16", platform: "ios" },
  ]);
});

test("keeps exclusion reasons attached to human target names", () => {
  const expansion: MatrixExpansion = {
    matrixId: "release",
    matrixName: "Release devices",
    resolvedAt: 1,
    profiles: [],
    excluded: [{ profile: target("old", "iPhone SE"), reason: "requires iOS 18" }],
  };
  assert.deepEqual(matrixRunPreview(expansion, 1).exclusions, [
    { name: "iPhone SE", reason: "requires iOS 18" },
  ]);
});
