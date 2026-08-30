import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import { proofCanCancel, proofPrimaryAction } from "./proof-actions.js";

function proof(
  state: ChangeVerification["state"],
  overrides: Partial<ChangeVerification> = {},
): ChangeVerification {
  return {
    state,
    planApproval: undefined,
    coverageGaps: [],
    builds: [{ id: "build" }],
    selection: {
      affectedJourneys: [{ appMapId: "map", testId: "test" }],
      targetCases: [{ id: "target", required: true }],
      cells: [{ id: "cell", requirement: "required" }],
      pilotCellId: "cell",
    },
    ...overrides,
  } as unknown as ChangeVerification;
}

test("presents one human action without lifecycle plumbing", () => {
  assert.deepEqual(proofPrimaryAction(proof("planning")), {
    kind: "approve-plan",
    label: "Approve plan",
    pendingLabel: "Approving…",
  });
  assert.equal(proofPrimaryAction(proof("ready"))?.label, "Run pilot");
  assert.equal(proofPrimaryAction(proof("running-pilot"))?.label, "Resume pilot");
  assert.equal(proofPrimaryAction(proof("awaiting-expansion"))?.label, "Run required coverage");
  assert.equal(proofPrimaryAction(proof("running"))?.label, "Resume coverage");
  assert.equal(proofPrimaryAction(proof("rejected"))?.label, "Rerun affected cases");
});

test("withholds approval until the frozen plan is complete", () => {
  assert.equal(
    proofPrimaryAction(proof("planning", { coverageGaps: ["Unknown impact"] })),
    undefined,
  );
  assert.equal(proofPrimaryAction(proof("planning", { builds: [] })), undefined);
  assert.equal(
    proofPrimaryAction(
      proof("planning", { selection: { affectedJourneys: [], targetCases: [], cells: [] } }),
    ),
    undefined,
  );
  assert.equal(proofPrimaryAction(proof("awaiting-build")), undefined);
  assert.equal(proofPrimaryAction(proof("proved")), undefined);
});

test("only non-terminal Proofs can be cancelled", () => {
  assert.equal(proofCanCancel(proof("planning")), true);
  assert.equal(proofCanCancel(proof("running")), true);
  for (const state of [
    "proved",
    "rejected",
    "needs-review",
    "insufficient-evidence",
    "cancelled",
    "superseded",
  ] as const) {
    assert.equal(proofCanCancel(proof(state)), false);
  }
});
