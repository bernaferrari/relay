export type DeliveryLoopProof = {
  id: string;
  version: number;
  state: string;
  decision?: string;
  repository: string;
  baseSha: string;
  headSha: string;
  buildIds: readonly string[];
  testIds: readonly string[];
  targetNames: readonly string[];
  runIds: readonly string[];
  planApproved: boolean;
  firstFailure?: { runId: string; summary: string; testId?: string };
  publication?: { conclusion?: string; checkRunId?: string | number; htmlUrl?: string };
};

export type DeliveryLoopPhase =
  | "prepare"
  | "awaiting-approval"
  | "running"
  | "failed"
  | "re-verifying"
  | "published"
  | "blocked";

export type DeliveryLoopSnapshot = {
  phase: DeliveryLoopPhase;
  original: DeliveryLoopProof;
  replacement?: DeliveryLoopProof;
  failureEvidence?: { runId: string; summary: string; testId?: string; proofId: string };
  replacementEvidence?: { runIds: readonly string[]; proofId: string; headSha: string };
  merge?: {
    proofId: string;
    conclusion: string;
    checkRunId?: string | number;
    htmlUrl?: string;
  };
  next: { action: string; reason: string };
};

function sameBuild(left: DeliveryLoopProof, right: DeliveryLoopProof): boolean {
  if (left.headSha === right.headSha) return true;
  if (!left.buildIds.length || !right.buildIds.length) return false;
  return (
    left.buildIds.length === right.buildIds.length &&
    left.buildIds.every((id, index) => id === right.buildIds[index])
  );
}

function isRunning(state: string): boolean {
  return state === "running" || state === "running-pilot" || state === "awaiting-expansion";
}

function isFailed(proof: DeliveryLoopProof): boolean {
  return (
    Boolean(proof.firstFailure) ||
    proof.decision === "rejected" ||
    proof.state === "rejected" ||
    proof.state === "needs-review" ||
    proof.state === "insufficient-evidence"
  );
}

function isProved(proof: DeliveryLoopProof): boolean {
  return proof.decision === "proved" || proof.state === "proved";
}

/** Classify the prove → fail → repair → re-verify → merge path.
 * A replacement Proof on a new build never rewrites the original failure. */
export function deliveryProofFromChangeInspect(value: {
  proof: {
    id: string;
    version: number;
    state: string;
    decision?: string;
    change: { repository: string; baseSha: string; headSha: string };
    builds: readonly { id: string }[];
    selection: {
      affectedJourneys: readonly { testId: string }[];
      targetCases: readonly { targetProfile?: { name?: string } }[];
    };
    runIds: readonly string[];
    planApproval?: unknown;
    firstCausalFailure?: { runId: string; summary: string; testId?: string };
  };
  publicationOutbox?: readonly {
    receipt?: {
      conclusion?: string;
      checkRunId?: string | number;
      htmlUrl?: string;
    };
  }[];
}): DeliveryLoopProof {
  const receipt = value.publicationOutbox?.find((item) => item.receipt)?.receipt;
  return {
    id: value.proof.id,
    version: value.proof.version,
    state: value.proof.state,
    ...(value.proof.decision ? { decision: value.proof.decision } : {}),
    repository: value.proof.change.repository,
    baseSha: value.proof.change.baseSha,
    headSha: value.proof.change.headSha,
    buildIds: value.proof.builds.map((build) => build.id),
    testIds: value.proof.selection.affectedJourneys.map((journey) => journey.testId),
    targetNames: value.proof.selection.targetCases.map(
      (target) => target.targetProfile?.name ?? "Unavailable target",
    ),
    runIds: [...value.proof.runIds],
    planApproved: value.proof.planApproval !== undefined,
    ...(value.proof.firstCausalFailure
      ? { firstFailure: { ...value.proof.firstCausalFailure } }
      : {}),
    ...(receipt
      ? {
          publication: {
            ...(receipt.conclusion ? { conclusion: receipt.conclusion } : {}),
            ...(receipt.checkRunId ? { checkRunId: receipt.checkRunId } : {}),
            ...(receipt.htmlUrl ? { htmlUrl: receipt.htmlUrl } : {}),
          },
        }
      : {}),
  };
}

export function classifyDeliveryLoop(input: {
  current: DeliveryLoopProof;
  predecessor?: DeliveryLoopProof;
}): DeliveryLoopSnapshot {
  const original = input.predecessor ?? input.current;
  const replacement = input.predecessor ? input.current : undefined;

  if (!original.buildIds.length || !original.testIds.length || !original.targetNames.length) {
    return {
      phase: "prepare",
      original,
      next: {
        action: "prepare-exact-configuration",
        reason: "Bind the exact build, Tests, and targets before proving this change.",
      },
    };
  }
  if (!original.planApproved && !replacement) {
    return {
      phase: "awaiting-approval",
      original,
      next: {
        action: "approve-plan",
        reason: "A human must approve the Verification Plan before execution.",
      },
    };
  }
  if (!replacement && isRunning(original.state)) {
    return {
      phase: "running",
      original,
      next: { action: "wait", reason: "Relay is executing the required Tests on the bound build." },
    };
  }
  if (replacement && sameBuild(original, replacement)) {
    return {
      phase: "blocked",
      original,
      replacement,
      failureEvidence: original.firstFailure
        ? { ...original.firstFailure, proofId: original.id }
        : undefined,
      next: {
        action: "provide-new-build",
        reason:
          "Replacement evidence requires a newer build or revision. The original failure stays unchanged.",
      },
    };
  }
  if (replacement) {
    const failure = replacement.firstFailure ?? original.firstFailure;
    if (isRunning(replacement.state)) {
      return {
        phase: "re-verifying",
        original,
        replacement,
        failureEvidence: original.firstFailure
          ? { ...original.firstFailure, proofId: original.id }
          : undefined,
        replacementEvidence: {
          runIds: replacement.runIds,
          proofId: replacement.id,
          headSha: replacement.headSha,
        },
        next: {
          action: "wait",
          reason:
            "Relay is verifying the replacement build. Original failure evidence stays on the prior Proof.",
        },
      };
    }
    if (isProved(replacement) && replacement.publication) {
      return {
        phase: "published",
        original,
        replacement,
        failureEvidence: original.firstFailure
          ? { ...original.firstFailure, proofId: original.id }
          : undefined,
        replacementEvidence: {
          runIds: replacement.runIds,
          proofId: replacement.id,
          headSha: replacement.headSha,
        },
        merge: {
          proofId: replacement.id,
          conclusion: replacement.publication.conclusion ?? "success",
          ...(replacement.publication.checkRunId
            ? { checkRunId: replacement.publication.checkRunId }
            : {}),
          ...(replacement.publication.htmlUrl ? { htmlUrl: replacement.publication.htmlUrl } : {}),
        },
        next: {
          action: "none",
          reason: "The replacement Proof published the exact merge result.",
        },
      };
    }
    if (isFailed(replacement) || isFailed(original)) {
      return {
        phase: "failed",
        original,
        replacement,
        failureEvidence: failure
          ? { ...failure, proofId: replacement.firstFailure ? replacement.id : original.id }
          : undefined,
        replacementEvidence: {
          runIds: replacement.runIds,
          proofId: replacement.id,
          headSha: replacement.headSha,
        },
        next: {
          action: "repair",
          reason:
            "A required Test failed. Use the causal evidence; do not treat the original Proof as verified.",
        },
      };
    }
    return {
      phase: "re-verifying",
      original,
      replacement,
      replacementEvidence: {
        runIds: replacement.runIds,
        proofId: replacement.id,
        headSha: replacement.headSha,
      },
      next: {
        action: "run-replacement",
        reason: "Run the replacement Proof on the new build.",
      },
    };
  }
  if (isProved(original) && original.publication) {
    return {
      phase: "published",
      original,
      merge: {
        proofId: original.id,
        conclusion: original.publication.conclusion ?? "success",
        ...(original.publication.checkRunId ? { checkRunId: original.publication.checkRunId } : {}),
        ...(original.publication.htmlUrl ? { htmlUrl: original.publication.htmlUrl } : {}),
      },
      next: { action: "none", reason: "This Proof published the exact merge result." },
    };
  }
  if (isFailed(original)) {
    return {
      phase: "failed",
      original,
      failureEvidence: original.firstFailure
        ? { ...original.firstFailure, proofId: original.id }
        : undefined,
      next: {
        action: "repair",
        reason: "A required Test failed on the bound build. Repair, then verify a new build.",
      },
    };
  }
  return {
    phase: "running",
    original,
    next: { action: "run", reason: "Verify the approved plan on the exact bound configuration." },
  };
}
