import { fail, fixtureFingerprint, isRecord } from "./golden-device-contract.mjs";

export const GOLDEN_HOST_FAULT_SCENARIOS = ["runnerKillMidSession", "ddiUnmountRecover"];

const RECEIPT_PROOF = {
  runnerKillMidSession: {
    disruption: "xctest-runner-process-absent",
    restoration: "xctest-session-ready",
  },
  ddiUnmountRecover: {
    disruption: "developer-disk-image-unmounted",
    restoration: "developer-disk-image-mounted",
  },
};

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function receiptFailure(scenario, phase, detail) {
  fail(
    `Golden ${scenario} ${phase} receipt ${detail}; the host fault is not proven.`,
    phase === "restoration"
      ? "GOLDEN_FAULT_RESTORATION_UNPROVEN"
      : "GOLDEN_FAULT_DISRUPTION_UNPROVEN",
  );
}

/**
 * Validate the deliberately small evidence boundary between the acceptance
 * runner and a quarantined host adapter. A successful Test recipe is not a
 * disruption receipt: the adapter must bind one exact fault observation to
 * one invocation, target fingerprint, bounded attempt, and expected proof.
 */
export function validateGoldenFaultReceipt(receipt, expected) {
  const { scenario, phase, fixture, invocationId, startedAt, deadlineAt } = expected;
  if (!GOLDEN_HOST_FAULT_SCENARIOS.includes(scenario)) {
    receiptFailure(scenario, phase, "uses an unsupported scenario");
  }
  if (phase !== "disruption" && phase !== "restoration") {
    receiptFailure(scenario, String(phase), "uses an unsupported phase");
  }
  if (
    !exactKeys(receipt, [
      "schemaVersion",
      "invocationId",
      "scenario",
      "phase",
      "target",
      "status",
      "attempts",
      "startedAt",
      "finishedAt",
      "proof",
    ])
  ) {
    receiptFailure(scenario, phase, "must contain exactly the reviewed receipt fields");
  }
  if (receipt.schemaVersion !== 1) receiptFailure(scenario, phase, "has the wrong schemaVersion");
  if (receipt.invocationId !== invocationId) {
    receiptFailure(scenario, phase, "does not match this invocation");
  }
  if (receipt.scenario !== scenario || receipt.phase !== phase) {
    receiptFailure(scenario, phase, "does not match the requested fault and phase");
  }
  if (
    !exactKeys(receipt.target, ["platform", "serialFingerprint"]) ||
    receipt.target.platform !== fixture.platform ||
    receipt.target.serialFingerprint !== fixtureFingerprint(fixture.serial)
  ) {
    receiptFailure(scenario, phase, "does not bind the configured fixture identity");
  }
  if (receipt.status !== "confirmed" || receipt.attempts !== 1) {
    receiptFailure(scenario, phase, "must confirm exactly one bounded host attempt");
  }
  if (
    !Number.isFinite(receipt.startedAt) ||
    !Number.isFinite(receipt.finishedAt) ||
    receipt.startedAt < startedAt ||
    receipt.finishedAt < receipt.startedAt ||
    receipt.finishedAt > deadlineAt
  ) {
    receiptFailure(scenario, phase, "falls outside the requested time bound");
  }
  if (
    !exactKeys(receipt.proof, ["kind", "observed"]) ||
    receipt.proof.kind !== RECEIPT_PROOF[scenario][phase] ||
    receipt.proof.observed !== true
  ) {
    receiptFailure(scenario, phase, "does not contain the exact required host observation");
  }
  return receipt;
}
