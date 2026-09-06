import type { AuthoringTarget } from "@relay/protocol";
import type { LiveTargetSession } from "./live-target-session";
import type { RecordingEvidenceControl } from "./recording-evidence-target";

export type ReviewTargetTryResult =
  | { kind: "tried"; detail: string }
  | { kind: "failed"; detail: string };

/** Send the selected control to the live Device without recording a new step. */
export async function tryReviewTarget(input: {
  previewTarget?: (target: AuthoringTarget) => Promise<LiveTargetSession>;
  selectedTarget?: AuthoringTarget;
  control: RecordingEvidenceControl;
}): Promise<ReviewTargetTryResult> {
  if (!input.previewTarget) {
    return {
      kind: "failed",
      detail: "Relay cannot open this Device to try the target.",
    };
  }
  if (!input.selectedTarget) {
    return {
      kind: "failed",
      detail: "This recording has no Device to try the target on.",
    };
  }

  const x = input.control.rect.x + input.control.rect.width / 2;
  const y = input.control.rect.y + input.control.rect.height / 2;
  let session: LiveTargetSession | undefined;
  try {
    session = await input.previewTarget(input.selectedTarget);
    await session.input({ kind: "touch", action: "down", x, y });
    await session.input({ kind: "touch", action: "up", x, y });
    return {
      kind: "tried",
      detail: `Relay tapped ${input.control.name} on the Device.`,
    };
  } catch (error) {
    return {
      kind: "failed",
      detail:
        error instanceof Error && error.message.trim()
          ? error.message
          : "Relay could not tap that control on the Device.",
    };
  } finally {
    session?.close();
  }
}
