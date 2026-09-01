import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type ChangeVerificationOperationId =
  | "proof.prepare"
  | "proof.setup.inspect"
  | "proof.setup.preview"
  | "proof.setup.apply"
  | "proof.start"
  | "proof.list"
  | "proof.inspect"
  | "proof.plan.approve"
  | "proof.continue"
  | "proof.run"
  | "proof.run.confirm"
  | "proof.run.human-evidence"
  | "proof.cancel"
  | "proof.publication.retry"
  | "proof.rerun-affected";

const { command, query } =
  createOperationBuilders<Pick<RelayOperationMap, ChangeVerificationOperationId>>();

export const changeVerificationOperationDefinitions = [
  query("proof.setup.inspect", "Inspect Proof setup", "/proofs/setup", {
    category: "authoring",
  }),
  command("proof.setup.preview", "Preview Proof setup", "POST", "/proofs/setup/preview", {
    category: "authoring",
  }),
  command("proof.setup.apply", "Apply reviewed Proof setup", "POST", "/proofs/setup/apply", {
    category: "authoring",
    confirmation: "confirm",
    idempotency: "inherent",
  }),
  command("proof.prepare", "Prepare current change Proof", "POST", "/proofs/prepare", {
    category: "authoring",
    idempotency: "inherent",
  }),
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
  command("proof.run", "Run Proof", "POST", "/proofs/:proofId/run", {
    category: "execution",
    minimumRole: "runner",
    progress: true,
    cancellable: true,
    idempotency: "inherent",
  }),
  command("proof.run.confirm", "Confirm Proof cell", "POST", "/proofs/:proofId/run/confirm", {
    category: "execution",
    minimumRole: "author",
    confirmation: "confirm",
    idempotency: "inherent",
  }),
  command(
    "proof.run.human-evidence",
    "Resume Proof after human step",
    "POST",
    "/proofs/:proofId/run/human-evidence",
    {
      category: "execution",
      minimumRole: "author",
      confirmation: "confirm",
      idempotency: "inherent",
    },
  ),
  command("proof.cancel", "Cancel Proof", "POST", "/proofs/:proofId/cancel", {
    category: "authoring",
    confirmation: "confirm",
    idempotency: "inherent",
  }),
  command(
    "proof.publication.retry",
    "Retry Proof merge check",
    "POST",
    "/proofs/:proofId/publications/:publicationId/retry",
    { category: "authoring", confirmation: "confirm", idempotency: "inherent" },
  ),
  command(
    "proof.rerun-affected",
    "Rerun affected Proof cases",
    "POST",
    "/proofs/:proofId/rerun-affected",
    { category: "authoring", idempotency: "inherent" },
  ),
] as const;
