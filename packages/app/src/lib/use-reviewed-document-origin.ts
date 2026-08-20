import { createEffect, createSignal, type Accessor } from "solid-js";
import type { ReviewedDocumentOriginInspection } from "@relay/protocol";
import { humanError } from "./human-error";
import {
  createReviewedDocumentOriginController,
  type ReviewedDocumentOriginReviewDecision,
  type ReviewedDocumentOriginRevocationDecision,
  type ReviewedDocumentOriginSelection,
  type ReviewedDocumentOriginTransport,
} from "./reviewed-document-origin-controller";

export type ReviewedDocumentOriginActionState = "idle" | "reviewing" | "revoking";

/**
 * A one-shot, selection-scoped reader for reviewed-origin state. Selection
 * changes cause exactly one canonical inspection query; this is never a poll
 * and none of these flows can issue target input.
 */
export function useReviewedDocumentOrigin(input: {
  selection: Accessor<ReviewedDocumentOriginSelection | undefined>;
  transport: ReviewedDocumentOriginTransport;
}) {
  const controller = createReviewedDocumentOriginController(input.transport);
  const [inspection, setInspection] = createSignal<ReviewedDocumentOriginInspection>();
  const [inspectionBusy, setInspectionBusy] = createSignal(false);
  const [actionState, setActionState] = createSignal<ReviewedDocumentOriginActionState>("idle");
  const [error, setError] = createSignal("");
  let inspectionVersion = 0;

  const selectionKey = (selection: ReviewedDocumentOriginSelection) =>
    [
      selection.appMapId,
      selection.screenId,
      selection.variantId,
      selection.captureId,
      selection.expectedRevision,
    ].join("\u0000");

  async function inspect(): Promise<ReviewedDocumentOriginInspection | undefined> {
    const selection = input.selection();
    if (!selection) {
      setInspection(undefined);
      return undefined;
    }
    const version = ++inspectionVersion;
    const key = selectionKey(selection);
    setInspectionBusy(true);
    setError("");
    try {
      const result = await controller.inspect(selection);
      if (
        version === inspectionVersion &&
        input.selection() &&
        selectionKey(input.selection()!) === key
      ) {
        setInspection(result);
      }
      return result;
    } catch (cause) {
      if (version === inspectionVersion) {
        setInspection(undefined);
        setError(humanError(cause, "Could not inspect this reviewed-origin lineage."));
      }
      throw cause;
    } finally {
      if (version === inspectionVersion) setInspectionBusy(false);
    }
  }

  async function review(decision: ReviewedDocumentOriginReviewDecision): Promise<void> {
    const selection = input.selection();
    if (!selection) throw new Error("Choose a current Android scroll surface before reviewing it.");
    setActionState("reviewing");
    setError("");
    try {
      await controller.review(selection, decision);
      await inspect();
    } catch (cause) {
      setError(humanError(cause, "Could not activate this reviewed origin."));
      throw cause;
    } finally {
      setActionState("idle");
    }
  }

  async function revoke(
    projectionId: string,
    decision: ReviewedDocumentOriginRevocationDecision,
  ): Promise<void> {
    const selection = input.selection();
    if (!selection) throw new Error("Choose a current Android scroll surface before revoking it.");
    setActionState("revoking");
    setError("");
    try {
      await controller.revoke(selection, projectionId, decision);
      await inspect();
    } catch (cause) {
      setError(humanError(cause, "Could not revoke this reviewed origin."));
      throw cause;
    } finally {
      setActionState("idle");
    }
  }

  createEffect(() => {
    const selection = input.selection();
    if (!selection) {
      ++inspectionVersion;
      setInspection(undefined);
      setInspectionBusy(false);
      setError("");
      return;
    }
    // This is a single persisted-evidence read for the newly selected
    // surface. It neither observes a device nor schedules another request.
    void inspect().catch(() => undefined);
  });

  return {
    inspection,
    inspectionBusy,
    actionState,
    error,
    inspect,
    review,
    revoke,
  };
}
