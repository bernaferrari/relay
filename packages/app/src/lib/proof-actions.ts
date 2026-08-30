import type { ChangeVerification } from "@relay/protocol";

export type ProofPrimaryAction = Readonly<{
  kind: "approve-plan" | "run" | "rerun-affected";
  label: string;
  pendingLabel: string;
}>;

const runningStates = new Set<ChangeVerification["state"]>([
  "running-pilot",
  "awaiting-expansion",
  "running",
]);

const terminalFailureStates = new Set<ChangeVerification["state"]>([
  "rejected",
  "needs-review",
  "insufficient-evidence",
]);

/** Present one product action from durable Proof truth. Transport actions and
 * optimistic versions stay out of the UI vocabulary. */
export function proofPrimaryAction(proof: ChangeVerification): ProofPrimaryAction | undefined {
  if (
    proof.state === "planning" &&
    !proof.planApproval &&
    proof.coverageGaps.length === 0 &&
    proof.builds.length > 0 &&
    proof.selection.affectedJourneys.length > 0 &&
    proof.selection.cells?.some(({ requirement }) => requirement === "required") &&
    proof.selection.pilotCellId !== undefined
  ) {
    return {
      kind: "approve-plan",
      label: "Approve plan",
      pendingLabel: "Approving…",
    };
  }
  if (proof.state === "ready") {
    return { kind: "run", label: "Run pilot", pendingLabel: "Starting pilot…" };
  }
  if (runningStates.has(proof.state)) {
    return {
      kind: "run",
      label:
        proof.state === "awaiting-expansion"
          ? "Run required coverage"
          : proof.state === "running-pilot"
            ? "Resume pilot"
            : "Resume coverage",
      pendingLabel: "Continuing…",
    };
  }
  if (terminalFailureStates.has(proof.state)) {
    return {
      kind: "rerun-affected",
      label: "Rerun affected cases",
      pendingLabel: "Preparing rerun…",
    };
  }
  return undefined;
}

export function proofCanCancel(proof: ChangeVerification): boolean {
  return ![
    "proved",
    "rejected",
    "needs-review",
    "insufficient-evidence",
    "cancelled",
    "superseded",
  ].includes(proof.state);
}
