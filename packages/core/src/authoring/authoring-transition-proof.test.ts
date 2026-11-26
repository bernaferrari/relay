import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringObservation } from "@relay/protocol";
import {
  authoringTransitionProofStatus,
  invalidateAuthoringActionProof,
} from "./authoring-transition-proof.js";

function observation(input: {
  id: string;
  pixels: "captured" | "unavailable";
  semantics: "current" | "stale" | "unavailable";
}): AuthoringObservation {
  return {
    id: input.id,
    capturedAt: 1,
    screen: {
      id: input.id,
      fingerprint: input.id,
      capturedAt: 1,
      source: "recording",
    },
    evidenceIds: [],
    proof: {
      schemaVersion: 1,
      captureOrder: "pixels-first",
      pixels: { status: input.pixels, capturedAt: 1 },
      semantics: { status: input.semantics, capturedAt: 1 },
    },
  };
}

test("authoring transition proof keeps current semantics distinct from usable pixels", () => {
  const entrance = observation({ id: "entrance", pixels: "captured", semantics: "current" });
  const exit = observation({ id: "exit", pixels: "captured", semantics: "current" });
  assert.equal(authoringTransitionProofStatus(entrance, exit), "verified");

  assert.equal(
    authoringTransitionProofStatus(
      entrance,
      observation({ id: "slow-ios", pixels: "captured", semantics: "unavailable" }),
    ),
    "pixels-only",
  );
  assert.equal(
    authoringTransitionProofStatus(
      observation({ id: "stale", pixels: "captured", semantics: "stale" }),
      exit,
    ),
    "pixels-only",
  );
  assert.equal(
    authoringTransitionProofStatus(
      observation({ id: "missing-raster", pixels: "unavailable", semantics: "current" }),
      exit,
    ),
    "unresolved",
  );
});

test("edited authoring actions cannot retain an earlier path's proof", () => {
  const cleared = invalidateAuthoringActionProof({
    id: "action",
    source: "captured",
    recordedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    steps: [],
    evidenceIds: ["evidence"],
    entranceObservationId: "entrance",
    exitObservationId: "exit",
    proofStatus: "verified",
  });
  assert.deepEqual(cleared, {
    id: "action",
    source: "captured",
    recordedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    steps: [],
    evidenceIds: ["evidence"],
  });
});
