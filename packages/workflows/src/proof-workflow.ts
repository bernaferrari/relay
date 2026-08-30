import type { OperationInput, OperationOutput } from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";

/**
 * The public Proof lifecycle is deliberately a thin naming seam over the
 * canonical operation registry. It keeps Proof vocabulary available to
 * humans and agents without adding a second state machine to workflows.
 */
export interface ProofWorkflow {
  prepareChangeVerification(
    input?: OperationInput<"proof.prepare">,
  ): Promise<OperationOutput<"proof.prepare">>;
  startChangeVerification(
    input: OperationInput<"proof.start">,
  ): Promise<OperationOutput<"proof.start">>;
  inspectChangeVerification(
    input: OperationInput<"proof.inspect">,
  ): Promise<OperationOutput<"proof.inspect">>;
  approveVerificationPlan(
    input: OperationInput<"proof.plan.approve">,
  ): Promise<OperationOutput<"proof.plan.approve">>;
  continueChangeVerification(
    input: OperationInput<"proof.continue">,
  ): Promise<OperationOutput<"proof.continue">>;
  cancelChangeVerification(
    input: OperationInput<"proof.cancel">,
  ): Promise<OperationOutput<"proof.cancel">>;
  rerunAffectedVerification(
    input: OperationInput<"proof.rerun-affected">,
  ): Promise<OperationOutput<"proof.rerun-affected">>;
  listChangeVerifications(
    input?: OperationInput<"proof.list">,
  ): Promise<OperationOutput<"proof.list">>;
}

export type ChangeVerificationWorkflow = ProofWorkflow;

export type PrepareChangeVerificationInput = OperationInput<"proof.prepare">;
export type StartChangeVerificationInput = OperationInput<"proof.start">;
export type InspectChangeVerificationInput = OperationInput<"proof.inspect">;
export type ApproveVerificationPlanInput = OperationInput<"proof.plan.approve">;
export type ContinueChangeVerificationInput = OperationInput<"proof.continue">;
export type CancelChangeVerificationInput = OperationInput<"proof.cancel">;
export type RerunAffectedVerificationInput = OperationInput<"proof.rerun-affected">;
export type ListChangeVerificationsInput = OperationInput<"proof.list">;

/**
 * Create the Proof lifecycle facade from an already validated operation port.
 * Each method preserves the operation's input/output shape, optimistic
 * version, and server-owned receipt exactly.
 */
export function createProofWorkflow(operations: RelayOperationPort): ProofWorkflow {
  return Object.freeze({
    prepareChangeVerification: (input: OperationInput<"proof.prepare"> = {}) =>
      operations.invoke("proof.prepare", input),
    startChangeVerification: (input: OperationInput<"proof.start">) =>
      operations.invoke("proof.start", input),
    inspectChangeVerification: (input: OperationInput<"proof.inspect">) =>
      operations.invoke("proof.inspect", input),
    approveVerificationPlan: (input: OperationInput<"proof.plan.approve">) =>
      operations.invoke("proof.plan.approve", input),
    continueChangeVerification: (input: OperationInput<"proof.continue">) =>
      operations.invoke("proof.continue", input),
    cancelChangeVerification: (input: OperationInput<"proof.cancel">) =>
      operations.invoke("proof.cancel", input),
    rerunAffectedVerification: (input: OperationInput<"proof.rerun-affected">) =>
      operations.invoke("proof.rerun-affected", input),
    listChangeVerifications: (input: OperationInput<"proof.list"> = {}) =>
      operations.invoke("proof.list", input),
  });
}

/** Naming alias for callers that use the protocol's internal Change
 * Verification term while retaining the public Proof lifecycle surface. */
export const createChangeVerificationWorkflow = createProofWorkflow;
