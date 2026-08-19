import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { combineIdFor, savedTestId, testCandidates } from "./app-map-combine-candidates";

function map(): AppMap {
  return {
    tests: {
      smoke: {
        id: "smoke",
        name: "Smoke",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [],
      },
    },
    flows: { recorded: { id: "recorded", name: "Recorded", connectionIds: ["open"] } },
    groups: { settings: { id: "settings", name: "Settings", screenIds: ["home"] } },
  } as unknown as AppMap;
}

test("combines offer saved graph Tests only", () => {
  const candidates = testCandidates(map());
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.source}:${candidate.id}`),
    ["test:smoke"],
  );
  assert.deepEqual(candidates.map(savedTestId), ["smoke"]);
});

test("combine IDs remain deterministic and keep their storage prefix", () => {
  assert.equal(
    combineIdFor(["Language", "Theme"], ["Smoke Test"]),
    "matrix-language-theme-to-smoke-test",
  );
  assert.equal(combineIdFor([], []), "matrix-to");
});
