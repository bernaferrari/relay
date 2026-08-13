import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import {
  matrixId,
  savedTestId,
  testCandidates,
  tourRootScreenId,
} from "./app-map-combine-candidates";

function map(): AppMap {
  return {
    tests: {
      reusable: {
        id: "reusable",
        name: "Reusable",
        kind: "path",
        flowId: "covered",
      },
    },
    flows: {
      covered: { id: "covered", name: "Covered", connectionIds: ["home-menu"] },
      recorded: { id: "recorded", name: "Recorded", connectionIds: ["menu-settings"] },
      empty: { id: "empty", name: "Empty", connectionIds: [] },
    },
    groups: {
      settings: { id: "settings", name: "Settings", screenIds: ["home", "menu", "details"] },
      empty: { id: "empty", name: "Empty", screenIds: [] },
    },
    connections: {
      "home-menu": {
        id: "home-menu",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "menu" },
      },
      "home-details": {
        id: "home-details",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "details" },
      },
      "menu-details": {
        id: "menu-details",
        fromScreenId: "menu",
        destination: { kind: "screen", screenId: "details" },
      },
    },
  } as unknown as AppMap;
}

test("testCandidates keeps reusable tests and only uncovered, non-empty map evidence", () => {
  const candidates = testCandidates(map());

  assert.deepEqual(
    candidates.map((candidate) => `${candidate.source}:${candidate.id}`),
    ["test:reusable", "flow:recorded", "group:settings"],
  );
  assert.equal(candidates[2]?.screenCount, 3);
});

test("candidate IDs stay compatible with persisted matrices", () => {
  const candidates = testCandidates(map());

  assert.deepEqual(candidates.map(savedTestId), ["reusable", "flow-recorded", "group-settings"]);
  assert.equal(
    matrixId(["Language", "Theme"], ["Smoke Test"]),
    "matrix-language-theme-to-smoke-test",
  );
  assert.equal(matrixId([], []), "matrix-to");
});

test("tourRootScreenId chooses the screen with the most in-group outgoing connections", () => {
  const current = map();
  const group = testCandidates(current).find((candidate) => candidate.source === "group");
  assert.ok(group);

  assert.equal(tourRootScreenId(current, group), "home");
});
