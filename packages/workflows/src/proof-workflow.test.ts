import assert from "node:assert/strict";
import test from "node:test";
import type { OperationId, OperationInput, OperationOutput } from "@relay/protocol";
import { createProofWorkflow, type ProofWorkflow } from "./proof-workflow.js";
import type { RelayOperationPort } from "./operation-port.js";

const change = {
  repository: "acme/app",
  baseSha: "1".repeat(40),
  headSha: "2".repeat(40),
} satisfies OperationInput<"proof.start">["change"];

function port(calls: Array<{ id: OperationId; input: unknown }>): RelayOperationPort {
  return {
    async invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>) {
      calls.push({ id, input });
      return { operationId: id } as OperationOutput<Id>;
    },
  };
}

test("Proof facade maps friendly lifecycle names to canonical operations", async () => {
  const calls: Array<{ id: OperationId; input: unknown }> = [];
  const proof: ProofWorkflow = createProofWorkflow(port(calls));
  const startInput = {
    change,
    policy: { id: "relay.default", version: 1 },
  } satisfies OperationInput<"proof.start">;
  const inspectInput = {
    proofId: "proof-1",
    includeHistory: true,
  } satisfies OperationInput<"proof.inspect">;
  const approveInput = {
    proofId: "proof-1",
    expectedVersion: 1,
    decisionId: "approve-1",
    reason: "The frozen plan matches the requested change.",
    confirm: true,
  } satisfies OperationInput<"proof.plan.approve">;
  const continueInput = {
    proofId: "proof-1",
    expectedVersion: 1,
    action: "request-plan-review",
    reason: "A human reviewer must inspect the frozen plan.",
  } satisfies OperationInput<"proof.continue">;
  const cancelInput = {
    proofId: "proof-1",
    expectedVersion: 1,
    reason: "The change was withdrawn.",
    confirm: true,
  } satisfies OperationInput<"proof.cancel">;
  const rerunInput = {
    proofId: "proof-1",
    expectedVersion: 1,
    change,
  } satisfies OperationInput<"proof.rerun-affected">;
  const retryPublicationInput = {
    proofId: "proof-1",
    publicationId: "publication-1",
    expectedProofVersion: 1,
    reason: "Provider connectivity is restored.",
    confirm: true,
  } satisfies OperationInput<"proof.publication.retry">;

  await proof.prepareChangeVerification();
  await proof.startChangeVerification(startInput);
  await proof.listChangeVerifications();
  await proof.inspectChangeVerification(inspectInput);
  await proof.approveVerificationPlan(approveInput);
  await proof.continueChangeVerification(continueInput);
  await proof.cancelChangeVerification(cancelInput);
  await proof.retryProofPublication(retryPublicationInput);
  await proof.rerunAffectedVerification(rerunInput);

  assert.deepEqual(calls, [
    { id: "proof.prepare", input: {} },
    { id: "proof.start", input: startInput },
    { id: "proof.list", input: {} },
    { id: "proof.inspect", input: inspectInput },
    { id: "proof.plan.approve", input: approveInput },
    { id: "proof.continue", input: continueInput },
    { id: "proof.cancel", input: cancelInput },
    { id: "proof.publication.retry", input: retryPublicationInput },
    { id: "proof.rerun-affected", input: rerunInput },
  ]);
});
