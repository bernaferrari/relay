/**
 * A newer capture of a screen the map already knows replaces its screenshot
 * and UI tree on its own. People fix mistakes afterwards; they never approve
 * a refreshed screen. The change is still recorded as an approved proposal,
 * and the replaced evidence stays on the variant (evidence ids accumulate).
 */
import { submitAppMapProposal } from "./entity-operations.js";
import type { AppMap, AppMapMutationContext, Proposal } from "./model.js";
import { mutateAppMap } from "./mutation.js";
import { approveAppMapProposal, rejectAppMapProposal } from "./proposal-operations.js";
import { patchScreen } from "./screen-operations.js";
import type { AppMapScreenCaptureReview } from "./recording-operations.js";

export const CAPTURE_REFRESH_APPLIED_REASON = "Applied automatically from a newer capture";
const SUPERSEDED_REASON = "Superseded by a newer capture of the same screen";

/** The exact shape `reviewAppMapScreenCapture` proposes: new evidence for one screen. */
export function isCaptureRefreshProposal(proposal: Proposal): boolean {
  if (proposal.changes.length !== 1) return false;
  const change = proposal.changes[0]!;
  if (change.kind !== "screen.update") return false;
  const { patch, upsertVariants, removeVariantIds } = change.input;
  return (
    Object.keys(patch ?? {}).length === 0 &&
    !removeVariantIds?.length &&
    Boolean(upsertVariants?.length) &&
    upsertVariants!.every((variant) => variant.screenId === change.screenId)
  );
}

function nextContext(map: AppMap, context: AppMapMutationContext, suffix: string) {
  return {
    ...context,
    expectedRevision: map.revision,
    eventId: `${context.eventId.slice(0, 120)}:${suffix}`,
    at: Math.max(context.at, map.updatedAt),
  };
}

/** Record the reviewed capture and apply it in the same step. */
export function applyAppMapScreenCaptureReview(
  map: AppMap,
  review: AppMapScreenCaptureReview,
  context: AppMapMutationContext,
): AppMap {
  const submitted = submitAppMapProposal(map, review.proposal, context);
  return approveAppMapProposal(
    submitted,
    review.proposal.id,
    nextContext(submitted, context, "apply"),
    CAPTURE_REFRESH_APPLIED_REASON,
  );
}

export function hasPendingCaptureRefresh(map: AppMap): boolean {
  return Object.values(map.proposals ?? {}).some(
    (proposal) => proposal.status === "pending" && isCaptureRefreshProposal(proposal),
  );
}

/**
 * Apply capture refreshes that older builds left waiting for a person. For
 * each variant only the newest capture is applied, and only when it is newer
 * than what the map shows; the rest are closed as superseded, never deleted.
 */
export function settleCaptureRefreshProposals(map: AppMap, context: AppMapMutationContext): AppMap {
  const pending = Object.values(map.proposals ?? {})
    .filter((proposal) => proposal.status === "pending" && isCaptureRefreshProposal(proposal))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const settled = new Set<string>();
  let next = map;
  pending.forEach((proposal, index) => {
    const change = proposal.changes[0]!;
    if (change.kind !== "screen.update") return;
    const variants = change.input.upsertVariants ?? [];
    const key = `${change.screenId}:${variants.map((variant) => variant.id).sort()}`;
    const step = nextContext(next, context, String(index));
    const newer =
      Boolean(next.screens[change.screenId]) &&
      variants.every(
        (variant) => variant.updatedAt > (next.screenVariants[variant.id]?.updatedAt ?? 0),
      );
    if (settled.has(key) || !newer) {
      settled.add(key);
      next = rejectAppMapProposal(next, proposal.id, step, SUPERSEDED_REASON);
      return;
    }
    settled.add(key);
    // Edits to the screen since the capture (a rename, a move) do not make
    // newer pixels wrong; the variant merge keeps both.
    next = mutateAppMap(
      next,
      step,
      {
        eventType: "proposal.approved",
        subject: { kind: "proposal", id: proposal.id },
        summary: `Applied a newer capture of ${change.screenId}`,
      },
      (draft) => {
        patchScreen(draft, change.screenId, change.input, step.at);
        const record = draft.proposals[proposal.id]!;
        record.status = "approved";
        record.decision = {
          actorId: step.actorId,
          at: step.at,
          reason: CAPTURE_REFRESH_APPLIED_REASON,
        };
        record.updatedAt = step.at;
      },
    );
  });
  return next;
}
