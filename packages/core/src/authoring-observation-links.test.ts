import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringObservation } from "@relay/protocol";
import {
  MAX_AUTHORING_RETAINED_OBSERVATIONS,
  authoringReplayActionProof,
  authoringRevisionObservations,
  retainAuthoringObservations,
} from "./authoring-observation-links.js";

function observation(input: {
  id: string;
  fingerprint: string;
  pixels?: "captured" | "unavailable";
  semantics?: "current" | "stale" | "unavailable";
}): AuthoringObservation {
  const pixels = input.pixels ?? "captured";
  const semantics = input.semantics ?? "current";
  return {
    id: input.id,
    capturedAt: 1,
    screen: { id: input.id, fingerprint: input.fingerprint, capturedAt: 1, source: "recording" },
    evidenceIds: [`evidence-${input.id}`],
    proof: {
      schemaVersion: 1,
      captureOrder: "concurrent",
      pixels:
        pixels === "captured"
          ? { status: "captured", capturedAt: 1, fingerprint: input.fingerprint }
          : { status: "unavailable" },
      semantics:
        semantics === "current"
          ? { status: "current", capturedAt: 1, fingerprint: input.fingerprint }
          : { status: semantics, capturedAt: 1 },
    },
  };
}

test("retains every linked observation without evicting endpoints", () => {
  const before = observation({ id: "before", fingerprint: "source" });
  const after = observation({ id: "after", fingerprint: "destination" });
  const retained = retainAuthoringObservations([before], [before, after]);

  assert.deepEqual(
    retained?.map((item) => item.id),
    ["before", "after"],
  );
  assert.deepEqual(
    authoringRevisionObservations({ observations: retained, before, after }).map((item) => item.id),
    ["before", "after"],
  );
});

test("refuses a new endpoint instead of silently evicting a linked observation", () => {
  const retained = Array.from({ length: MAX_AUTHORING_RETAINED_OBSERVATIONS }, (_, index) =>
    observation({ id: `observation-${index}`, fingerprint: `screen-${index}` }),
  );
  assert.equal(
    retainAuthoringObservations(retained, [observation({ id: "overflow", fingerprint: "next" })]),
    undefined,
  );
});

test("keeps pixels-only endpoints useful while refusing to infer a semantic edge", () => {
  const entrance = observation({ id: "entrance", fingerprint: "same", semantics: "stale" });
  const exit = observation({ id: "exit", fingerprint: "same", semantics: "stale" });
  assert.deepEqual(
    authoringReplayActionProof({ action: { id: "action" }, outcome: "passed", entrance, exit }),
    {
      actionId: "action",
      outcome: "passed",
      proofStatus: "pixels-only",
      transition: "unproven",
      entranceObservationId: "entrance",
      exitObservationId: "exit",
      evidenceIds: ["evidence-entrance", "evidence-exit"],
    },
  );
});

test("marks a current same semantic identity as unchanged, not a new edge", () => {
  const entrance = observation({ id: "entrance", fingerprint: "same" });
  const exit = observation({ id: "exit", fingerprint: "same" });
  assert.equal(
    authoringReplayActionProof({ action: { id: "wait" }, outcome: "passed", entrance, exit })
      .transition,
    "unchanged",
  );
});
