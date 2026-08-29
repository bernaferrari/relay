import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type ChangeVerificationOperationId =
  | "proof.start"
  | "proof.list"
  | "proof.inspect"
  | "proof.plan.approve"
  | "proof.continue"
  | "proof.cancel"
  | "proof.rerun-affected";

const { command, query } =
  createOperationBuilders<Pick<RelayOperationMap, ChangeVerificationOperationId>>();

export const changeVerificationOperationDefinitions = [
  command("proof.start", "Start Proof", "POST", "/proofs", {
    category: "authoring",
    idempotency: "inherent",
  }),
  query("proof.list", "List Proofs", "/proofs", {
    category: "evidence",
    minimumRole: "viewer",
  }),
  query("proof.inspect", "Inspect Proof", "/proofs/:proofId", {
    category: "evidence",
    minimumRole: "viewer",
  }),
  command(
    "proof.plan.approve",
    "Approve Verification Plan",
    "POST",
    "/proofs/:proofId/plan/approve",
    { category: "authoring", confirmation: "confirm", idempotency: "inherent" },
  ),
  command("proof.continue", "Continue Proof", "POST", "/proofs/:proofId/continue", {
    category: "authoring",
    idempotency: "inherent",
  }),
  command("proof.cancel", "Cancel Proof", "POST", "/proofs/:proofId/cancel", {
    category: "authoring",
    confirmation: "confirm",
    idempotency: "inherent",
  }),
  command(
    "proof.rerun-affected",
    "Rerun affected Proof cases",
    "POST",
    "/proofs/:proofId/rerun-affected",
    { category: "authoring", idempotency: "inherent" },
  ),
] as const;
