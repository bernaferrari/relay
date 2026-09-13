import { useEffect, useState } from "react";
import type {
  ProductRecordingState,
  RecordingEvidencePreview,
} from "../data/recording-product-service";

export type ReviewAction = NonNullable<
  NonNullable<ProductRecordingState["snapshot"]>["review"]
>["actions"][number];

export function proofLabel(proof: "verified" | "pixels-only" | "unresolved"): string {
  if (proof === "verified") return "Verified";
  if (proof === "pixels-only") return "Visual evidence";
  return "Unbound";
}

export function useEvidenceObjectUrl(
  preview: RecordingEvidencePreview | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview || typeof URL.createObjectURL !== "function") {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(
      new Blob([Uint8Array.from(preview.bytes).buffer], { type: preview.mime }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [preview]);
  return url;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0:00";
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function recordedMomentCount(count: number): string {
  return count === 1 ? "1 step" : `${count} steps`;
}

export function reviewActionCopy(action: ReviewAction): {
  title: string;
  detail: string;
  kind: "action" | "checkpoint" | "observation" | "pause";
} {
  const proof = action.proofStatus ? proofLabel(action.proofStatus) : undefined;
  if (isPauseAction(action)) {
    return { title: "Pause", detail: "Relay waited before the next step.", kind: "pause" };
  }
  if (
    action.stepCount === 0 &&
    (/^0 recorded steps$/iu.test(action.intent) || /^0 recorded steps$/iu.test(action.label ?? ""))
  ) {
    return {
      title: "Screen capture",
      detail: proof ?? "Current screen",
      kind: "observation",
    };
  }
  if (action.stepCount === 0 && action.label) {
    return {
      title: action.label,
      detail: proof ? `Screen capture · ${proof}` : "Screen capture",
      kind: "checkpoint",
    };
  }
  if (action.stepCount === 0 || /^0 recorded steps$/i.test(action.intent)) {
    return {
      title: "Screen capture",
      detail: proof ?? "Current screen",
      kind: "observation",
    };
  }
  const count = action.stepCount === 1 ? "1 action" : `${action.stepCount} actions`;
  return {
    title: action.label ?? humanActionTitle(action.intent),
    detail: proof ? `${count} · ${proof}` : count,
    kind: "action",
  };
}

function isPauseAction(action: ReviewAction): boolean {
  return /^recorded pause$/iu.test(action.label ?? "") || /^recorded pause$/iu.test(action.intent);
}

function humanActionTitle(intent: string): string {
  const value = intent.trim();
  if (/^(?:tap|click)(?: (?:the|a))? (?:target|captured target)$/iu.test(value)) {
    return "Tap the highlighted control";
  }
  const namedTarget = /^(?:tap|click)\s+[“'"](.+)[”'"]$/iu.exec(value)?.[1]?.trim();
  if (namedTarget) return `Tap ${namedTarget}`;
  const direct = /^(?:tap|click)\s+(?:label|text)\s+(.+)$/iu.exec(value)?.[1]?.trim();
  if (direct) return `Tap ${direct.replace(/^['"]|['"]$/gu, "")}`;
  if (/^(?:scroll|swipe)\b/iu.test(value)) return "Scroll";
  if (/^(?:type|enter text)\b/iu.test(value)) return "Type text";
  if (/^(?:press|key)\s+enter$/iu.test(value)) return "Press Enter";
  if (/identifier|selector|xpath|coordinates?|app:id|\{.+\}/iu.test(value)) {
    return "Recorded interaction";
  }
  return value || "Recorded interaction";
}

export function captureSummary(actions: readonly ReviewAction[]): string {
  if (actions.length === 0) return "No steps yet";
  if (actions.every((action) => action.captureProof === "replay-proved")) {
    return "Verified by Relay";
  }
  if (
    actions.some(
      (action) =>
        action.captureProof === "inferred-unproved" ||
        action.captureProof === "instrumented-unproved",
    )
  ) {
    return "Replay needed";
  }
  return "Recorded by Relay";
}

export function reviewInstruction(
  replayRequired: boolean | undefined,
  canApprove: boolean,
): string {
  if (canApprove) return "Review the steps, then save the Test.";
  if (replayRequired) return "Review the steps, then replay before saving the Test.";
  return "Review the steps while Relay prepares the next action.";
}

export function replayTitle(
  outcome: "passed" | "failed" | "cancelled" | undefined,
  required: boolean | undefined,
  canApprove: boolean,
) {
  if (canApprove) return "Ready to save";
  if (outcome === "passed" && !required) return "Verified";
  if (outcome === "failed") return "Replay needs attention";
  if (outcome === "cancelled") return "Replay was cancelled";
  return "Replay required";
}

export function replayDetail(
  outcome: "passed" | "failed" | "cancelled" | undefined,
  canApprove: boolean,
) {
  if (outcome === "passed" && canApprove) {
    return "Relay verified this exact reviewed version. It can now be saved.";
  }
  if (outcome === "passed") return "Steps changed. Replay this version before saving.";
  if (outcome === "failed") {
    return "Relay could not verify the recorded steps. Check the Device, then replay it again.";
  }
  if (outcome === "cancelled") return "Run the replay again when the Device is ready.";
  return "Replay the reviewed steps on the selected Device.";
}
