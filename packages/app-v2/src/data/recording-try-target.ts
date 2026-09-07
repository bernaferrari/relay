import type { AuthoringTarget } from "@relay/protocol";
import type { LiveTargetSession } from "./live-target-session";
import type {
  RecordingEvidenceControl,
  RecordingEvidenceTarget,
} from "./recording-evidence-target";

export type ReviewTargetTryResult =
  | { kind: "tried"; detail: string; binding: RecordingEvidenceTarget }
  | { kind: "failed"; detail: string }
  | { kind: "unknown"; detail: string; binding: RecordingEvidenceTarget };

const OBSERVATION_LOCAL_REF = /^(node[-_:]?\d+|\d+|ref[-_:]?.+)$/iu;

export function reviewTargetBinding(
  control: RecordingEvidenceControl,
): RecordingEvidenceTarget | { rejected: string } {
  const identifier = control.target.identifier?.trim();
  if (identifier) {
    if (OBSERVATION_LOCAL_REF.test(identifier)) {
      return {
        rejected: "This identifier is observation-local and is not a stable replay binding.",
      };
    }
    return { identifier };
  }
  if (control.target.label?.trim()) return { label: control.target.label.trim() };
  if (control.target.text?.trim()) return { text: control.target.text.trim() };
  return { rejected: "This control has no semantic binding to try." };
}

function sameBinding(left: RecordingEvidenceTarget, right: RecordingEvidenceTarget): boolean {
  if (left.identifier && right.identifier) return left.identifier === right.identifier;
  if (left.label && right.label) return left.label === right.label;
  if (left.text && right.text) return left.text === right.text;
  return false;
}

/** Try and saved replay send this binding — never a historic rectangle center. */
export async function dispatchSemanticBinding(
  session: Pick<LiveTargetSession, "input">,
  binding: RecordingEvidenceTarget,
): Promise<void> {
  await session.input({ kind: "tap", target: binding });
}

/** Send the selected semantic binding to the live Device without recording a new step. */
export async function tryReviewTarget(input: {
  previewTarget?: (target: AuthoringTarget) => Promise<LiveTargetSession>;
  selectedTarget?: AuthoringTarget;
  control: RecordingEvidenceControl;
  confirmStartingState?: () => Promise<{ ok: true } | { ok: false; detail: string }>;
  observe?: (session: LiveTargetSession) => Promise<readonly RecordingEvidenceControl[]>;
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
  const binding = reviewTargetBinding(input.control);
  if ("rejected" in binding) {
    return { kind: "failed", detail: binding.rejected };
  }
  if (!input.confirmStartingState) {
    return {
      kind: "failed",
      detail: "Try target must confirm the required starting state before exercising the binding.",
    };
  }
  const starting = await input.confirmStartingState();
  if (!starting.ok) return { kind: "failed", detail: starting.detail };
  if (!input.observe) {
    return {
      kind: "failed",
      detail:
        "Try target needs a fresh observation to resolve the saved binding. Historic coordinates are not a trial.",
    };
  }

  let session: LiveTargetSession | undefined;
  try {
    session = await input.previewTarget(input.selectedTarget);
    const fresh = [...(await input.observe(session))];
    const resolved = fresh.find((control) => {
      const next = reviewTargetBinding(control);
      return !("rejected" in next) && sameBinding(next, binding);
    });
    if (!resolved) {
      return {
        kind: "failed",
        detail:
          "The proposed binding is not on the current screen. Restore the starting state before trying it.",
      };
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Relay could not prepare that binding on the Device.";
    return { kind: "failed", detail: message };
  }
  try {
    await dispatchSemanticBinding(session, binding);
    return {
      kind: "tried",
      binding,
      detail: `Relay tried ${binding.identifier ?? binding.label ?? binding.text} as the saved binding.`,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Relay could not confirm whether that tap reached the Device.";
    return { kind: "unknown", binding, detail: message };
  } finally {
    session?.close();
  }
}
